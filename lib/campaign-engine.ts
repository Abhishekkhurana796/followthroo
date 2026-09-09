/**
 * Campaign conditional-node engine.
 *
 * A campaign's `sequence` is a node graph (send / condition / wait / exit). Each lead is
 * an Enrollment that walks the graph one node at a time. Instead of enqueuing every step
 * up-front, we enqueue a single "advance" job per hop — so branches, waits, and
 * reply-driven stops all happen reactively at run time.
 *
 * Default behavior: a reply anywhere halts the enrollment (stop-on-reply). A `condition`
 * node lets a campaign branch explicitly on replied/opened/clicked.
 */
import { z } from "zod";
import { prisma } from "./db";
import { logActivity } from "./crm";
import { jitterMs } from "./ratelimit";
import { enqueueJob } from "./queue";
import { processSendJob } from "./job-processor";
import type { Enrollment } from "@prisma/client";
import { INVITE_NOTE_MAX, worstCaseNoteLength } from "./linkedin/note";

const CHANNELS = ["email", "linkedin", "whatsapp", "social"] as const;

export const LINKEDIN_ACTIONS = ["invite", "message", "auto"] as const;
export type LinkedInAction = (typeof LINKEDIN_ACTIONS)[number];

export const SendNode = z.object({
  id: z.string(),
  type: z.literal("send"),
  channel: z.enum(CHANNELS),
  /// Which LinkedIn gesture this step performs — a connection request or a
  /// direct message. It lives here rather than as two extra `channel` values
  /// because `channel` is a Prisma enum shared by Message, Template and
  /// ConversationEvent: splitting it would mean a migration across three tables
  /// and templates authored per-kind, when an invite note and a follow-up
  /// message are quite reasonably the same LinkedIn template.
  ///
  /// Absent on every campaign built before LinkedIn steps existed. Those resolve
  /// to "auto", which is exactly what they already did — invite, falling back to
  /// a message if the person is already a connection.
  linkedinAction: z.enum(LINKEDIN_ACTIONS).optional(),
  templateId: z.string().nullable().optional(),
  /// Pins this step to one snapshot of the template's wording. Without it the
  /// body is resolved live at send time, so editing the template rewrites every
  /// unsent step of every running sequence. This is what "apply to future
  /// campaigns only" pins, and what "update this campaign's unsent messages"
  /// repoints.
  templateVersionId: z.string().nullable().optional(),
  waitDays: z.number().min(0).default(0),
  next: z.string().nullable().optional(),
});

export const ConditionNode = z.object({
  id: z.string(),
  type: z.literal("condition"),
  on: z.enum(["replied", "not_replied", "opened", "not_opened", "clicked"]),
  withinDays: z.number().min(0).optional(),
  onYes: z.string().nullable().optional(),
  onNo: z.string().nullable().optional(),
});

export const WaitNode = z.object({
  id: z.string(),
  type: z.literal("wait"),
  waitDays: z.number().min(0).default(1),
  next: z.string().nullable().optional(),
});

export const ExitNode = z.object({ id: z.string(), type: z.literal("exit") });

export const CampaignNode = z.discriminatedUnion("type", [SendNode, ConditionNode, WaitNode, ExitNode]);
export type CampaignNode = z.infer<typeof CampaignNode>;

/**
 * What a step actually does on LinkedIn.
 *
 * One place decides it, so the engine, the validator and the builder cannot
 * disagree about what an older campaign with no explicit kind means.
 */
export function linkedinActionFor(node: CampaignNode): LinkedInAction {
  return node.type === "send" && node.channel === "linkedin"
    ? node.linkedinAction ?? "auto"
    : "auto";
}

export const GraphSequence = z.object({
  nodes: z.array(CampaignNode),
  startNodeId: z.string().nullable().optional(),
});

// Legacy flat step array (older campaigns / the simple builder).
const LegacyStep = z.object({
  channel: z.enum(CHANNELS),
  templateId: z.string().nullable().optional(),
  /// Pins this step to one snapshot of the template's wording. Without it the
  /// body is resolved live at send time, so editing the template rewrites every
  /// unsent step of every running sequence. This is what "apply to future
  /// campaigns only" pins, and what "update this campaign's unsent messages"
  /// repoints.
  templateVersionId: z.string().nullable().optional(),
  waitDays: z.number().min(0).default(0),
  unless: z.string().optional(),
  onlyIf: z.string().optional(),
});

export const CampaignSequence = z.union([GraphSequence, z.array(LegacyStep)]);
export type CampaignSequence = z.infer<typeof CampaignSequence>;

export interface NormalizedGraph {
  nodes: Record<string, CampaignNode>;
  startNodeId: string | null;
}

/**
 * Refuse a sequence that cannot work, at the moment it is saved.
 *
 * This lives on the server rather than in the builder because the builder is not
 * the only writer — the agent and any API client save campaigns through the same
 * two routes, and a check that only runs in one client is not a check.
 *
 * It is deliberately about things that are knowable now. The exact rendered
 * length of a note is not (a variable can be any length), so this uses the
 * worst case and `lib/channels/linkedin.ts` still measures the real string at
 * send time.
 */
export async function validateSequence(
  organizationId: string,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const graph = normalizeSequence(raw);
  const nodes = Object.values(graph.nodes);

  // Step numbers are what the person sees in the builder, so errors name those
  // rather than internal node ids.
  const numberOf = new Map(nodes.map((n, i) => [n.id, i + 1]));

  for (const node of nodes) {
    if (node.type !== "send") continue;
    if (node.linkedinAction && node.channel !== "linkedin") {
      return {
        ok: false,
        message: `Step ${numberOf.get(node.id)} is not a LinkedIn step, so it cannot have a LinkedIn action.`,
      };
    }
  }

  const inviteSteps = nodes.filter(
    (n) => n.type === "send" && n.channel === "linkedin" && linkedinActionFor(n) === "invite" && n.templateId,
  );
  if (!inviteSteps.length) return { ok: true };

  // One query, scoped to the org — an unscoped `id: { in: [...] }` here would
  // read another tenant's templates.
  const ids = inviteSteps.map((n) => (n.type === "send" ? n.templateId! : "")).filter(Boolean);
  const templates = await prisma.template.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, body: true },
  });
  const byId = new Map(templates.map((t) => [t.id, t.body ?? ""]));

  for (const node of inviteSteps) {
    if (node.type !== "send") continue;
    const body = byId.get(node.templateId!);
    if (body === undefined) {
      return { ok: false, message: `Step ${numberOf.get(node.id)} uses a template that no longer exists.` };
    }
    const length = worstCaseNoteLength(body);
    if (length > INVITE_NOTE_MAX) {
      return {
        ok: false,
        message: `Step ${numberOf.get(node.id)}'s connection note reaches about ${length} characters once personalised, and LinkedIn allows ${INVITE_NOTE_MAX}. Shorten the template.`,
      };
    }
  }

  return { ok: true };
}

/** Convert a stored sequence (graph OR legacy flat array) into a node map. */
export function normalizeSequence(raw: unknown): NormalizedGraph {
  const parsed = CampaignSequence.safeParse(raw);
  if (!parsed.success) return { nodes: {}, startNodeId: null };
  const seq = parsed.data;

  if (Array.isArray(seq)) {
    const nodes: Record<string, CampaignNode> = {};
    seq.forEach((s, i) => {
      const id = `n${i}`;
      nodes[id] = {
        id,
        type: "send",
        channel: s.channel,
        templateId: s.templateId ?? null,
        waitDays: s.waitDays,
        next: i < seq.length - 1 ? `n${i + 1}` : null,
      };
    });
    return { nodes, startNodeId: seq.length ? "n0" : null };
  }

  const nodes: Record<string, CampaignNode> = {};
  for (const n of seq.nodes) nodes[n.id] = n;
  return { nodes, startNodeId: seq.startNodeId ?? seq.nodes[0]?.id ?? null };
}

function delayForNodeMs(node: CampaignNode): number {
  if (node.type === "send") return node.waitDays * 86_400_000 + jitterMs();
  if (node.type === "wait") return node.waitDays * 86_400_000;
  return 0;
}

/** Set the enrollment's current node + nextRunAt and enqueue the advance that runs it. */
export async function scheduleAdvance(enrollmentId: string, node: CampaignNode): Promise<boolean> {
  const delay = delayForNodeMs(node);
  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { currentNodeId: node.id, nextRunAt: new Date(Date.now() + delay) },
  });
  return enqueueJob({ kind: "advance", enrollmentId }, delay);
}

/**
 * How long a run holds an enrollment before the sweep may retry it. A crashed or
 * timed-out advance releases itself implicitly once the lease expires.
 */
const CLAIM_LEASE_MS = 15 * 60_000;
/** Tolerance for a queue callback that lands slightly ahead of its own nextRunAt. */
const CLAIM_GRACE_MS = 60_000;

/**
 * Atomically take ownership of a due enrollment, so a late queue callback and the
 * recovery sweep can never run the same node twice. Returns false if the enrollment
 * is not due, not active, or already claimed by another runner.
 */
async function claimEnrollment(id: string): Promise<boolean> {
  const { count } = await prisma.enrollment.updateMany({
    where: {
      id,
      status: "active",
      nextRunAt: { lte: new Date(Date.now() + CLAIM_GRACE_MS) },
    },
    data: { nextRunAt: new Date(Date.now() + CLAIM_LEASE_MS) },
  });
  return count === 1;
}

async function finish(id: string, status: "completed" | "stopped" | "replied") {
  await prisma.enrollment.update({ where: { id }, data: { status, nextRunAt: null } });
}

/** Has the lead replied since this enrollment began (optionally within N days)? */
/**
 * Has this contact replied since being enrolled?
 *
 * Deliberately lead-wide rather than campaign-scoped: the product promise is
 * "a reply anywhere pauses the rest for that lead", and a person who answered
 * one sequence should not keep receiving another.
 *
 * The precision now comes from what writes `type: "replied"` in the first
 * place. lib/inbox/store.ts only uses it when an inbound mail's
 * In-Reply-To/References names a message we actually sent; a new enquiry from a
 * known contact is logged as `inbound` instead. So this stayed as it was while
 * the false positives went away — but that makes the activity type load-bearing:
 * do not start writing "replied" for anything unverified.
 */
async function hasReplied(enr: Enrollment): Promise<boolean> {
  const since = enr.createdAt;
  const a = await prisma.activityLog.findFirst({
    where: {
      leadId: enr.leadId,
      ...(enr.organizationId ? { organizationId: enr.organizationId } : {}),
      type: "replied",
      at: { gte: since },
    },
  });
  return !!a;
}

async function hasActivity(enr: Enrollment, type: "opened" | "clicked"): Promise<boolean> {
  const a = await prisma.activityLog.findFirst({
    where: {
      leadId: enr.leadId,
      ...(enr.organizationId ? { organizationId: enr.organizationId } : {}),
      type,
      at: { gte: enr.createdAt },
    },
  });
  return !!a;
}

async function evaluateCondition(enr: Enrollment, node: z.infer<typeof ConditionNode>): Promise<boolean> {
  switch (node.on) {
    case "replied": return hasReplied(enr);
    case "not_replied": return !(await hasReplied(enr));
    case "opened": return hasActivity(enr, "opened");
    case "not_opened": return !(await hasActivity(enr, "opened"));
    case "clicked": return hasActivity(enr, "clicked");
    default: return false;
  }
}

/**
 * Advance one enrollment by executing its current node and scheduling the next hop.
 * Idempotent-ish: a rate-limit inside a send re-throws so the queue retries this advance
 * (the enrollment's currentNodeId hasn't moved, so the send re-runs).
 */
export async function advanceEnrollment(enrollmentId: string): Promise<void> {
  const enr = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { campaign: true },
  });
  if (!enr) return;
  if (enr.status !== "active") return; // paused / replied / stopped / completed

  // Respect the campaign's own status. Pausing or finishing a campaign only ever set
  // Campaign.status — it never touched in-flight enrollments — so without this a resumed
  // hop (queue callback or sweep) would keep sending out of a campaign the user stopped.
  if (enr.campaign.status !== "active") {
    if (enr.campaign.status === "paused") {
      // Hold, don't kill: re-check in an hour so unpausing resumes the sequence.
      await prisma.enrollment.update({
        where: { id: enr.id },
        data: { nextRunAt: new Date(Date.now() + 60 * 60_000) },
      });
    }
    return;
  }

  // Take the lease before doing any work — this is the only thing preventing a duplicate
  // send when a delayed queue callback and the recovery sweep both fire for one hop.
  if (!(await claimEnrollment(enr.id))) return;
  if (!enr.currentNodeId) return finish(enr.id, "completed");

  const orgId = enr.organizationId ?? enr.campaign.organizationId;
  if (!orgId) return finish(enr.id, "stopped");

  const graph = normalizeSequence(enr.campaign.sequence);
  const node = graph.nodes[enr.currentNodeId];
  if (!node) return finish(enr.id, "completed");

  let nextId: string | null = null;

  if (node.type === "exit") {
    return finish(enr.id, "completed");
  }

  if (node.type === "send") {
    // Default stop-on-reply: never send another message after the lead has replied.
    if (await hasReplied(enr)) return finish(enr.id, "replied");
    await processSendJob({
      kind: "send",
      organizationId: orgId,
      channel: node.channel,
      linkedinAction: node.channel === "linkedin" ? linkedinActionFor(node) : undefined,
      nodeId: node.id,
      leadId: enr.leadId,
      campaignId: enr.campaignId,
      templateId: node.templateId ?? undefined,
      templateVersionId: node.templateVersionId ?? undefined,
      // No fallback sender: a campaign with no mailbox fails visibly on the message
      // record rather than going out under the platform's address.
      account: enr.campaign.sendingAccountId ?? undefined,
    });
    nextId = node.next ?? null;
  } else if (node.type === "wait") {
    nextId = node.next ?? null;
  } else if (node.type === "condition") {
    const yes = await evaluateCondition(enr, node);
    await prisma.enrollment.update({
      where: { id: enr.id },
      data: { branch: `${node.on}:${yes ? "yes" : "no"}` },
    });
    nextId = (yes ? node.onYes : node.onNo) ?? null;
  }

  if (!nextId) return finish(enr.id, "completed");
  const nextNode = graph.nodes[nextId];
  if (!nextNode) return finish(enr.id, "completed");

  const queued = await scheduleAdvance(enr.id, nextNode);
  if (!queued) {
    // scheduleAdvance writes nextRunAt *before* attempting the publish, so a failed
    // enqueue would otherwise leave a row that looks perfectly scheduled forever.
    // Roll it back into the past and let sweepDueEnrollments retry the hop.
    await prisma.enrollment.update({
      where: { id: enr.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    await logActivity({
      organizationId: orgId,
      leadId: enr.leadId,
      campaignId: enr.campaignId,
      type: "enrollment_enqueue_failed",
      meta: { from: node.id, to: nextNode.id },
    }).catch(() => {});
    return;
  }
  await logActivity({
    organizationId: orgId,
    leadId: enr.leadId,
    campaignId: enr.campaignId,
    type: "enrollment_advanced",
    meta: { from: node.id, to: nextNode.id },
  }).catch(() => {});
}

/**
 * Recovery sweep: run every enrollment whose nextRunAt is overdue.
 *
 * A sequence normally lives as a single in-flight queue message per lead, so one dropped
 * or failed publish used to strand that lead silently and permanently. This makes the
 * database the source of truth for what is due — it is the reader the
 * `@@index([status, nextRunAt])` on Enrollment was always built for.
 *
 * `overdueMs` keeps the sweep clear of the normal path: only hops that are late by more
 * than the grace period are touched, so it never races a healthy queue callback.
 */
export async function sweepDueEnrollments(opts: {
  organizationId?: string;
  overdueMs?: number;
  limit?: number;
} = {}): Promise<{ due: number; recovered: number; failed: number }> {
  const { organizationId, overdueMs = 10 * 60_000, limit = 200 } = opts;
  const due = await prisma.enrollment.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: new Date(Date.now() - overdueMs) },
      // Never resurrect leads on a draft/paused/finished campaign. Enrollments outlive the
      // campaign status that created them, and a sweep is exactly where that bites.
      campaign: { status: "active" },
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let recovered = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      await advanceEnrollment(id);
      recovered++;
    } catch (e) {
      failed++;
      console.error(`[sweep] enrollment ${id} failed to advance:`, e);
    }
  }
  return { due: due.length, recovered, failed };
}
