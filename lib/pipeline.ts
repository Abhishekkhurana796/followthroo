/**
 * Generic pipeline engine.
 *
 * One set of mechanics — ordered stages, per-stage SLA timers, drag-drop moves,
 * mandatory reason capture on backward moves, escalation up the org hierarchy —
 * that every department configures for itself. Built once, so adding Support or
 * Collections is a configuration change, not another pipeline implementation.
 */
import { prisma } from "./db";
import type { Department, StageKind } from "@prisma/client";
import { invalidate } from "./cache";

export type StageSeed = { name: string; kind?: StageKind; slaHours?: number | null };

/**
 * Department templates from the PRD. These are starting points a group leader
 * edits — the engine has no opinion about stage names.
 */
export const PIPELINE_TEMPLATES: Record<Department, { name: string; stages: StageSeed[] }> = {
  sales: {
    name: "Sales",
    stages: [
      { name: "Enquiry received", slaHours: 4 },
      { name: "Talks initiated", slaHours: 24 },
      { name: "Problem statement gathered", slaHours: 48 },
      { name: "Proposal sent", slaHours: 72 },
      { name: "Negotiation", slaHours: 96 },
      { name: "Won", kind: "won" },
      { name: "Lost", kind: "lost" },
    ],
  },
  marketing: {
    name: "Marketing",
    stages: [
      { name: "Captured", slaHours: 2 },
      { name: "Qualifying", slaHours: 24 },
      { name: "MQL", slaHours: 48 },
      { name: "Handed to sales", kind: "won" },
      { name: "Disqualified", kind: "lost" },
    ],
  },
  support: {
    name: "Support",
    stages: [
      { name: "New", slaHours: 1 },
      { name: "Investigating", slaHours: 8 },
      { name: "Waiting on customer", slaHours: 72 },
      { name: "Resolved", kind: "won" },
      { name: "Closed without resolution", kind: "lost" },
    ],
  },
  collections: {
    name: "Collections",
    stages: [
      { name: "Due", slaHours: 24 },
      { name: "Contacted", slaHours: 48 },
      { name: "Promise to pay", slaHours: 168 },
      { name: "Escalated", slaHours: 72 },
      { name: "Recovered", kind: "won" },
      { name: "Written off", kind: "lost" },
    ],
  },
  recruitment: {
    name: "Recruitment",
    stages: [
      { name: "Applied", slaHours: 48 },
      { name: "Screened", slaHours: 72 },
      { name: "Interview", slaHours: 120 },
      { name: "Offer", slaHours: 72 },
      { name: "Hired", kind: "won" },
      { name: "Rejected", kind: "lost" },
    ],
  },
};

export async function createPipeline(
  organizationId: string,
  department: Department,
  opts: { name?: string; isDefault?: boolean; stages?: StageSeed[] } = {},
) {
  const tpl = PIPELINE_TEMPLATES[department];
  const stages = opts.stages ?? tpl.stages;
  return prisma.pipeline.create({
    data: {
      organizationId,
      department,
      name: opts.name ?? tpl.name,
      isDefault: opts.isDefault ?? false,
      stages: {
        create: stages.map((s, i) => ({
          name: s.name,
          position: i,
          kind: s.kind ?? "open",
          slaHours: s.slaHours ?? null,
        })),
      },
    },
    include: { stages: { orderBy: { position: "asc" } } },
  });
}

/**
 * Every non-archived pipeline for an org, with its stages and item count. Pass
 * `department` for a group-leader/member caller (PRD §4) so they only ever see their own
 * department's pipeline(s) — omit it for owner/admin, who see every department.
 */
export async function listPipelines(organizationId: string, department?: Department) {
  if (department) {
    // A department-scoped caller still needs *a* pipeline to land on — seed theirs if
    // it doesn't exist yet, same idea as ensureDefaultPipeline but per-department.
    const has = await prisma.pipeline.findFirst({ where: { organizationId, department, archivedAt: null } });
    if (!has) await createPipeline(organizationId, department);
  } else {
    await ensureDefaultPipeline(organizationId);
  }
  return prisma.pipeline.findMany({
    where: { organizationId, archivedAt: null, ...(department && { department }) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: {
      stages: { orderBy: { position: "asc" } },
      _count: { select: { items: true } },
    },
  });
}

/** Idempotent: the org's default Sales pipeline, created on first use. */
export async function ensureDefaultPipeline(organizationId: string) {
  const existing = await prisma.pipeline.findFirst({
    where: { organizationId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (existing) return existing;
  return createPipeline(organizationId, "sales", { isDefault: true });
}

export class StageHasItems extends Error {
  constructor() {
    super("This stage still has contacts in it — move them first.");
    this.name = "StageHasItems";
  }
}

/**
 * Reassign every stage in `orderedIds` to its index as the new position.
 *
 * Two passes because `@@unique([pipelineId, position])` is checked per
 * statement, not deferred: swapping two stages' positions directly would have
 * one UPDATE collide with the row that hasn't moved yet. Landing everyone on a
 * distinct negative position first guarantees no positive value is held by more
 * than one row at any point, so the second pass can never collide.
 */
async function reindexStages(pipelineId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.pipelineStage.update({ where: { id }, data: { position: -(i + 1) } })),
  );
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.pipelineStage.update({ where: { id }, data: { position: i } })),
  );
}

/** Add a stage to a pipeline, inserted at `atPosition` (default: append). */
export async function addStage(args: {
  organizationId: string;
  pipelineId: string;
  name: string;
  kind?: StageKind;
  slaHours?: number | null;
  atPosition?: number;
}) {
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: args.pipelineId, organizationId: args.organizationId },
  });
  if (!pipeline) throw new Error("Pipeline not found.");

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: args.pipelineId },
    orderBy: { position: "asc" },
  });

  const created = await prisma.pipelineStage.create({
    data: {
      pipelineId: args.pipelineId,
      name: args.name,
      kind: args.kind ?? "open",
      slaHours: args.slaHours ?? null,
      // Placeholder — reindexStages below assigns the real, final position.
      position: stages.length,
    },
  });

  const ids = stages.map((s) => s.id);
  ids.splice(Math.max(0, Math.min(args.atPosition ?? ids.length, ids.length)), 0, created.id);
  await reindexStages(args.pipelineId, ids);

  invalidate(`pipeline:${args.organizationId}`);
  return prisma.pipelineStage.findUniqueOrThrow({ where: { id: created.id } });
}

/** Rename, retime, retype, or reorder a stage. Any subset of fields may be passed. */
export async function updateStage(args: {
  organizationId: string;
  stageId: string;
  name?: string;
  kind?: StageKind;
  slaHours?: number | null;
  /** New 0-based position among the pipeline's stages. */
  position?: number;
}) {
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: args.stageId, pipeline: { organizationId: args.organizationId } },
  });
  if (!stage) throw new Error("Stage not found.");

  const { name, kind, slaHours } = args;
  if (name !== undefined || kind !== undefined || slaHours !== undefined) {
    await prisma.pipelineStage.update({
      where: { id: stage.id },
      data: {
        ...(name !== undefined && { name }),
        ...(kind !== undefined && { kind }),
        ...(slaHours !== undefined && { slaHours }),
      },
    });
  }

  if (args.position !== undefined) {
    const siblings = await prisma.pipelineStage.findMany({
      where: { pipelineId: stage.pipelineId },
      orderBy: { position: "asc" },
    });
    const ids = siblings.map((s) => s.id).filter((id) => id !== stage.id);
    ids.splice(Math.max(0, Math.min(args.position, ids.length)), 0, stage.id);
    await reindexStages(stage.pipelineId, ids);
  }

  invalidate(`pipeline:${args.organizationId}`);
  return prisma.pipelineStage.findUniqueOrThrow({ where: { id: stage.id } });
}

/** Remove a stage. Refuses if it still holds contacts, or if it's the pipeline's last stage. */
export async function deleteStage(args: { organizationId: string; stageId: string }) {
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: args.stageId, pipeline: { organizationId: args.organizationId } },
    include: { _count: { select: { items: true } } },
  });
  if (!stage) throw new Error("Stage not found.");
  if (stage._count.items > 0) throw new StageHasItems();

  const siblings = await prisma.pipelineStage.findMany({
    where: { pipelineId: stage.pipelineId },
    orderBy: { position: "asc" },
  });
  if (siblings.length <= 1) throw new Error("A pipeline needs at least one stage.");

  await prisma.pipelineStage.delete({ where: { id: stage.id } });
  await reindexStages(
    stage.pipelineId,
    siblings.filter((s) => s.id !== stage.id).map((s) => s.id),
  );

  invalidate(`pipeline:${args.organizationId}`);
}

function slaDue(from: Date, slaHours: number | null | undefined): Date | null {
  if (!slaHours || slaHours <= 0) return null;
  return new Date(from.getTime() + slaHours * 3600_000);
}

/**
 * Pick an owner per the pipeline's `assignmentRule`. `manual` (the default) returns null
 * — nobody's assigned unless a caller says so explicitly. `territory`/`source`-based
 * rules aren't implemented: there's no territory concept in the data model, and a
 * source-routing table would be new scope, not a gap in what's already here.
 */
async function computeAutoAssignee(pipeline: {
  id: string;
  organizationId: string;
  department: Department;
  assignmentRule: string;
  lastAssignedMemberId: string | null;
}): Promise<string | null> {
  if (pipeline.assignmentRule === "manual") return null;

  const members = await prisma.member.findMany({
    where: { organizationId: pipeline.organizationId, department: pipeline.department },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (members.length === 0) return null;

  if (pipeline.assignmentRule === "round_robin") {
    const ids = members.map((m) => m.userId);
    const lastIdx = pipeline.lastAssignedMemberId ? ids.indexOf(pipeline.lastAssignedMemberId) : -1;
    const next = ids[(lastIdx + 1) % ids.length];
    await prisma.pipeline.update({ where: { id: pipeline.id }, data: { lastAssignedMemberId: next } });
    return next;
  }

  if (pipeline.assignmentRule === "workload") {
    // Fewest currently-open items in THIS pipeline wins; members with zero open items
    // never show up in the groupBy at all, hence the default-to-0 lookup below.
    const counts = await prisma.pipelineItem.groupBy({
      by: ["ownerId"],
      where: { pipelineId: pipeline.id, closedAt: null },
      _count: { _all: true },
    });
    const countFor = new Map(counts.filter((c) => c.ownerId).map((c) => [c.ownerId as string, c._count._all]));
    let best = members[0].userId;
    let bestCount = countFor.get(best) ?? 0;
    for (const m of members) {
      const c = countFor.get(m.userId) ?? 0;
      if (c < bestCount) {
        best = m.userId;
        bestCount = c;
      }
    }
    return best;
  }

  return null;
}

/** Put a contact into a pipeline at its first stage. Idempotent per pipeline. */
export async function addToPipeline(args: {
  organizationId: string;
  pipelineId: string;
  leadId: string;
  ownerId?: string | null;
  sourceId?: string | null;
  value?: number | null;
}) {
  const { organizationId, pipelineId, leadId } = args;

  const existing = await prisma.pipelineItem.findUnique({
    where: { pipelineId_leadId: { pipelineId, leadId } },
  });
  if (existing) return existing;

  const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
  if (!pipeline) throw new Error("Pipeline not found.");

  const first = await prisma.pipelineStage.findFirst({
    where: { pipelineId },
    orderBy: { position: "asc" },
  });
  if (!first) throw new Error("Pipeline has no stages.");

  // `undefined` means "not specified, auto-assign if the pipeline says to"; an explicit
  // `null` means "leave unassigned" and is respected as-is.
  const ownerId = args.ownerId !== undefined ? args.ownerId : await computeAutoAssignee(pipeline);

  const now = new Date();
  const item = await prisma.pipelineItem.create({
    data: {
      organizationId,
      pipelineId,
      stageId: first.id,
      leadId,
      ownerId,
      sourceId: args.sourceId ?? null,
      value: args.value ?? null,
      enteredStageAt: now,
      slaDueAt: slaDue(now, first.slaHours),
    },
  });

  await prisma.stageTransition.create({
    data: { itemId: item.id, fromStageId: null, toStageId: first.id, direction: "forward", actorKind: "system" },
  });
  invalidate(`pipeline:${organizationId}`);
  return item;
}

export class BackwardMoveNeedsReason extends Error {
  constructor() {
    super("Moving a contact backwards requires a reason.");
    this.name = "BackwardMoveNeedsReason";
  }
}

/**
 * Move an item to a stage.
 *
 * Backward moves must carry a reason — that is the whole point of capturing
 * them, and it is enforced here rather than in the UI so the API, the agent and
 * a future bulk import all obey the same rule.
 */
export async function moveToStage(args: {
  organizationId: string;
  itemId: string;
  toStageId: string;
  actorId?: string | null;
  /** `ai` marks moves driven by extraction rather than a rep updating a dropdown. */
  actorKind?: "user" | "ai" | "system";
  reason?: string | null;
}) {
  const { organizationId, itemId, toStageId } = args;

  const item = await prisma.pipelineItem.findFirst({
    where: { id: itemId, organizationId },
    include: { stage: true },
  });
  if (!item) throw new Error("Pipeline item not found.");

  const to = await prisma.pipelineStage.findFirst({
    where: { id: toStageId, pipelineId: item.pipelineId },
  });
  if (!to) throw new Error("That stage belongs to a different pipeline.");
  if (to.id === item.stageId) return item;

  const direction = to.position > item.stage.position ? "forward" : "backward";
  const reason = args.reason?.trim() || null;
  if (direction === "backward" && !reason) throw new BackwardMoveNeedsReason();

  const now = new Date();
  const terminal = to.kind !== "open";

  const [updated] = await prisma.$transaction([
    prisma.pipelineItem.update({
      where: { id: item.id },
      data: {
        stageId: to.id,
        enteredStageAt: now,
        // A terminal stage stops the clock; re-opening restarts it.
        slaDueAt: terminal ? null : slaDue(now, to.slaHours),
        slaBreachedAt: null,
        closedAt: terminal ? now : null,
      },
    }),
    prisma.stageTransition.create({
      data: {
        itemId: item.id,
        fromStageId: item.stageId,
        toStageId: to.id,
        direction,
        reason,
        actorId: args.actorId ?? null,
        actorKind: args.actorKind ?? "user",
      },
    }),
  ]);

  invalidate(`pipeline:${organizationId}`);
  return updated;
}

/**
 * Everything past its SLA, most overdue first. Cross-pipeline and cross-department by
 * default (the PRD's ageing view is one list, not one per team) — but a group-leader/
 * member caller passes `department` to scope it to just their own, per PRD §4.
 */
export async function getAgeing(organizationId: string, limit = 100, department?: Department) {
  const now = new Date();
  const items = await prisma.pipelineItem.findMany({
    where: {
      organizationId,
      closedAt: null,
      slaDueAt: { not: null, lt: now },
      ...(department && { pipeline: { department } }),
    },
    orderBy: { slaDueAt: "asc" },
    take: limit,
    include: {
      stage: { select: { id: true, name: true, slaHours: true } },
      pipeline: { select: { id: true, name: true, department: true } },
      lead: { select: { id: true, firstName: true, lastName: true, email: true, company: true } },
      source: { select: { key: true, label: true } },
    },
  });
  return items.map((i) => ({
    ...i,
    value: i.value ? Number(i.value) : null,
    overdueHours: i.slaDueAt ? Math.floor((now.getTime() - i.slaDueAt.getTime()) / 3600_000) : 0,
  }));
}

/**
 * Mark newly-breached items, record an escalation against the owner's manager, and
 * actually deliver it by email. Idempotent: `slaBreachedAt` is the guard, so re-running
 * never double-escalates.
 *
 * Email is the only delivery channel today — WhatsApp would need a phone number on the
 * escalation target, and neither User nor Member has one (confirmed absent; the same gap
 * that blocks a per-rep "connect your number" flow for click-to-call). Recorded honestly
 * in each event's `meta.channels` rather than claiming a delivery that didn't happen.
 */
export async function sweepSlaBreaches(organizationId: string) {
  const now = new Date();
  const due = await prisma.pipelineItem.findMany({
    where: { organizationId, closedAt: null, slaBreachedAt: null, slaDueAt: { not: null, lt: now } },
    select: {
      id: true,
      ownerId: true,
      lead: { select: { firstName: true, lastName: true, email: true } },
      stage: { select: { name: true } },
      pipeline: { select: { name: true } },
    },
    take: 500,
  });
  if (due.length === 0) return { breached: 0, escalated: 0 };

  await prisma.pipelineItem.updateMany({
    where: { id: { in: due.map((d) => d.id) } },
    data: { slaBreachedAt: now },
  });

  // Escalate one level up the hierarchy the org actually declared.
  let escalated = 0;
  for (const item of due) {
    const manager = item.ownerId
      ? await prisma.member.findFirst({
          where: { organizationId, userId: item.ownerId },
          select: { manager: { select: { userId: true } } },
        })
      : null;
    const toUserId = manager?.manager?.userId ?? null;

    const channels: string[] = [];
    if (toUserId) {
      const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { email: true, name: true } });
      if (target?.email) {
        const contactName = [item.lead.firstName, item.lead.lastName].filter(Boolean).join(" ") || item.lead.email || "A contact";
        // Internal escalation to a manager — platform mailbox, not the customer's.
        const { sendSystemEmail } = await import("./channels/email");
        const sent = await sendSystemEmail(
          target.email,
          `Overdue: ${contactName} in ${item.pipeline.name}`,
          `${contactName} has been sitting in "${item.stage.name}" past its SLA and needs attention.`,
        ).catch(() => false);
        if (sent) channels.push("email");
      }
    }

    await prisma.escalationEvent.create({
      data: {
        organizationId,
        itemId: item.id,
        level: toUserId ? 2 : 1,
        toUserId,
        channel: channels[0] ?? "in_app",
        meta: { channels, reason: toUserId ? undefined : "no manager on file to escalate to" },
      },
    });
    escalated++;
  }

  invalidate(`pipeline:${organizationId}`);
  return { breached: due.length, escalated };
}

/**
 * Sweep every org with at least one pipeline — the scheduled-cron entry point
 * (scripts/setup-qstash-schedules.ts, every 15 min). `GET /api/ageing` already sweeps
 * its own org on read, so this exists purely to catch a breach even when nobody's
 * looking at the Ageing page — "real-time" here means a tight polling loop, not a
 * message bus, which is disproportionate to what a Vercel-serverless app needs.
 */
export async function sweepAllOrgsSlaBreaches() {
  const orgs = await prisma.pipeline.findMany({
    where: { archivedAt: null },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  const results: Record<string, { breached: number; escalated: number }> = {};
  for (const { organizationId } of orgs) {
    results[organizationId] = await sweepSlaBreaches(organizationId);
  }
  return { orgs: orgs.length, results };
}

/**
 * Board data: stages in order, each with its items. `department` scopes a group-leader/
 * member caller to their own department (PRD §4) — an explicit `pipelineId` outside that
 * department returns null (not found) rather than leaking another team's board.
 */
export async function getBoard(organizationId: string, pipelineId?: string, department?: Department) {
  let pipeline;
  if (pipelineId) {
    pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
    if (pipeline && department && pipeline.department !== department) return null;
  } else if (department) {
    pipeline = await prisma.pipeline.findFirst({ where: { organizationId, department, archivedAt: null }, orderBy: { createdAt: "asc" } });
    if (!pipeline) pipeline = await createPipeline(organizationId, department);
  } else {
    pipeline = await ensureDefaultPipeline(organizationId);
  }
  if (!pipeline) return null;

  const [stages, items] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { position: "asc" } }),
    prisma.pipelineItem.findMany({
      where: { pipelineId: pipeline.id, organizationId },
      orderBy: { enteredStageAt: "asc" },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, email: true, company: true, score: true } },
        source: { select: { key: true, label: true } },
      },
    }),
  ]);

  const now = Date.now();
  return {
    pipeline: { id: pipeline.id, name: pipeline.name, department: pipeline.department },
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      slaHours: s.slaHours,
      items: items
        .filter((i) => i.stageId === s.id)
        .map((i) => ({
          id: i.id,
          leadId: i.leadId,
          name: [i.lead.firstName, i.lead.lastName].filter(Boolean).join(" ") || i.lead.email || "Unnamed contact",
          company: i.lead.company,
          email: i.lead.email,
          source: i.source?.label ?? null,
          value: i.value ? Number(i.value) : null,
          ownerId: i.ownerId,
          score: i.lead.score,
          enteredStageAt: i.enteredStageAt.toISOString(),
          slaDueAt: i.slaDueAt?.toISOString() ?? null,
          overdue: !!(i.slaDueAt && i.slaDueAt.getTime() < now),
        })),
    })),
  };
}

/** Escalation audit log, most recent first. `department` scopes a group-leader/member
 *  caller to their own department, same as getAgeing. */
export async function getEscalations(organizationId: string, limit = 100, department?: Department) {
  const events = await prisma.escalationEvent.findMany({
    // A department filter is inherently pipeline-scoped, so it must not also
    // hide every task escalation — those have no pipeline to filter on.
    where: { organizationId, ...(department && { item: { pipeline: { department } } }) },
    orderBy: { sentAt: "desc" },
    take: limit,
    include: {
      item: {
        select: {
          id: true,
          lead: { select: { id: true, firstName: true, lastName: true, email: true } },
          stage: { select: { name: true } },
          pipeline: { select: { id: true, name: true, department: true } },
        },
      },
      task: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          leadId: true,
          lead: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  const userIds = [...new Set(events.map((e) => e.toUserId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return events.map((e) => ({
    id: e.id,
    level: e.level,
    channel: e.channel,
    sentAt: e.sentAt.toISOString(),
    meta: e.meta,
    to: e.toUserId ? userById.get(e.toUserId) ?? null : null,
    item: e.item,
    task: e.task
      ? { ...e.task, dueAt: e.task.dueAt ? e.task.dueAt.toISOString() : null }
      : null,
  }));
}

/** Share of stage moves the AI drove — the PRD's headline success metric. */
export async function getAiMoveShare(organizationId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.stageTransition.groupBy({
    by: ["actorKind"],
    where: { at: { gte: since }, item: { organizationId } },
    _count: { _all: true },
  });
  const total = rows.reduce((n, r) => n + r._count._all, 0);
  const ai = rows.find((r) => r.actorKind === "ai")?._count._all ?? 0;
  return { total, ai, share: total === 0 ? 0 : ai / total };
}
