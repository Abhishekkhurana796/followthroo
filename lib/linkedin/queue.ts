/**
 * LinkedIn action queue. Campaigns enqueue actions (the official API can't send
 * invites/DMs); the companion Chrome extension claims and performs them in the user's own
 * logged-in LinkedIn tab, then reports results. Daily caps + stale-claim recovery live here.
 */
import { prisma } from "../db";
import { logActivity } from "../crm";
import { recordConversationEvent } from "../conversation";
import { randomUUID } from "node:crypto";

const STALE_MS = 15 * 60 * 1000; // reclaim actions stuck "in_progress" (browser closed mid-run)
const DRAFT_STALE_MS = 40 * 60 * 1000; // longer grace for "drafted" — a human has to actually read and act

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function enqueueLinkedInAction(input: {
  organizationId: string;
  leadId: string;
  linkedinUrl: string;
  note?: string | null;
  campaignId?: string | null;
  type?: string;
}) {
  return prisma.linkedInAction.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      linkedinUrl: input.linkedinUrl,
      note: input.note ?? null,
      campaignId: input.campaignId ?? null,
      type: input.type ?? "auto",
      // Provisional: claimActions settles it from the account's settings when an
      // "auto" action is actually handed out.
      kind: linkedinKind(input.type ?? "auto"),
      status: "pending",
    },
  });
}

/** Counts pending + today's throughput for the connect UI. */
export async function queueStats(organizationId: string) {
  const [pending, sentToday, failedToday] = await Promise.all([
    prisma.linkedInAction.count({ where: { organizationId, status: "pending" } }),
    prisma.linkedInAction.count({ where: { organizationId, status: "sent", sentAt: { gte: startOfDay() } } }),
    prisma.linkedInAction.count({ where: { organizationId, status: "failed", updatedAt: { gte: startOfDay() } } }),
  ]);
  return { pending, sentToday, failedToday };
}

type PerCampaign = { cap?: number; mode?: string; enabled?: boolean };

export interface ClaimAccount {
  organizationId: string;
  dailyInviteCap: number;
  mode: string;
  selectedCampaignIds: string[];
  campaignSettings: unknown;
  /** Optional so existing callers and tests compile; absent reads as off. */
  autoSend?: boolean;
}

/**
 * Which lead columns travel with an action.
 *
 * `peekActions` shows these to a person deciding whether to start a run, so it
 * needs enough to recognise somebody — a bare first name is not enough to tell
 * two Priyas apart. `claimActions` gets the same shape so both paths agree.
 */
const LEAD_FOR_ACTION = {
  id: true,
  firstName: true,
  lastName: true,
  company: true,
  title: true,
  linkedinUrl: true,
  stage: true,
  optedOut: true,
} as const;

/**
 * The actions that are eligible right now, in the order they would be worked.
 *
 * Shared by `claimActions` (which then marks them in_progress) and `peekActions`
 * (which does not). That sharing is the whole point: the list shown to somebody
 * before they press Start has to be the list that actually goes out. Two
 * separate implementations of "which ones are eligible" would drift, and the
 * drift would only ever be discovered as invitations sent to the wrong people.
 */
async function selectClaimable(account: ClaimAccount, limit: number) {
  const organizationId = account.organizationId;
  const startOfToday = startOfDay();
  const settings = (account.campaignSettings ?? {}) as Record<string, PerCampaign>;
  const selected = account.selectedCampaignIds ?? [];

  const usedGlobal = await prisma.linkedInAction.count({
    where: { organizationId, status: { in: ["sent", "in_progress", "drafted"] }, updatedAt: { gte: startOfToday } },
  });
  const take = Math.min(Math.max(0, account.dailyInviteCap - usedGlobal), limit);
  if (take <= 0) return [];

  // Pull a small candidate window and filter in JS (handles campaign selection, per-campaign
  // caps, disabled campaigns, and run-a-book actions that have no campaignId).
  const candidates = await prisma.linkedInAction.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "asc" },
    take: take * 5 + 20,
    include: { lead: { select: LEAD_FOR_ACTION } },
  });

  // Deleting a campaign cancels what it queued, but an advance already running
  // at that moment can still enqueue one more — and the old delete left queued
  // actions behind entirely. An action whose campaign no longer exists (or is
  // archived) is never handed out: an invitation cannot be recalled.
  const campaignIds = [...new Set(candidates.map((a) => a.campaignId).filter((v): v is string => !!v))];
  const liveCampaigns = new Set(
    campaignIds.length
      ? (
          await prisma.campaign.findMany({
            where: { id: { in: campaignIds }, organizationId, archivedAt: null },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [],
  );

  const usedCache = new Map<string, number>();
  const usedFor = async (cid: string) => {
    if (!usedCache.has(cid)) {
      usedCache.set(cid, await prisma.linkedInAction.count({
        where: { organizationId, campaignId: cid, status: { in: ["sent", "in_progress", "drafted"] }, updatedAt: { gte: startOfToday } },
      }));
    }
    return usedCache.get(cid)!;
  };

  const picked: typeof candidates = [];
  for (const a of candidates) {
    if (picked.length >= take) break;
    // Consent outranks every other rule here. A lead who opted out must never be
    // contacted, whatever a campaign says — and an invitation cannot be recalled.
    if (a.lead?.optedOut) continue;
    const cid = a.campaignId;
    if (cid) {
      if (!liveCampaigns.has(cid)) continue;
      if (selected.length && !selected.includes(cid)) continue;
      const s = settings[cid];
      if (s?.enabled === false) continue;
      if (typeof s?.cap === "number" && (await usedFor(cid)) + picked.filter((p) => p.campaignId === cid).length >= s.cap) continue;
    }
    picked.push(a);
  }
  return picked;
}

/** Release actions stranded by a browser that closed mid-run. */
async function reclaimStale(organizationId: string) {
  await prisma.linkedInAction.updateMany({
    where: {
      organizationId,
      OR: [
        { status: "in_progress", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        // A human never came back to confirm or skip a drafted action — release it rather
        // than let it block the queue forever.
        { status: "drafted", updatedAt: { lt: new Date(Date.now() - DRAFT_STALE_MS) } },
      ],
    },
    data: { status: "pending" },
  });
}

/**
 * Who is next, without touching anything.
 *
 * The desktop app shows this before a run so the person can see exactly who is
 * about to be contacted. Deliberately read-only — no reclaim, no status change —
 * because looking at the queue must never consume it or change what happens.
 */
export async function peekActions(account: ClaimAccount, limit: number) {
  const picked = await selectClaimable(account, limit);
  return picked.map((a) => ({
    id: a.id,
    type: a.type && a.type !== "auto" ? a.type : account.mode || "auto",
    linkedinUrl: a.linkedinUrl,
    note: a.note,
    leadId: a.lead?.id ?? null,
    leadName: [a.lead?.firstName, a.lead?.lastName].filter(Boolean).join(" ") || null,
    company: a.lead?.company ?? null,
    title: a.lead?.title ?? null,
    stage: a.lead?.stage ?? null,
  }));
}

/**
 * Hand the desktop app its next batch of actions, honoring the account's config:
 * selected campaigns, the global daily cap, per-campaign caps, and enabled flags.
 * Each returned action carries its effective `type` (auto/invite/message). Stale
 * in-progress actions are reclaimed first so a closed browser doesn't strand the queue.
 */
export async function claimActions(account: ClaimAccount, limit: number) {
  await reclaimStale(account.organizationId);

  const picked = await selectClaimable(account, limit);
  if (picked.length === 0) return [];

  await prisma.linkedInAction.updateMany({
    where: { id: { in: picked.map((p) => p.id) } },
    data: { status: "in_progress" },
  });

  const settings = (account.campaignSettings ?? {}) as Record<string, PerCampaign>;

  // An explicit kind on the action is an instruction from the campaign step
  // that created it; the account/campaign mode is only a preference for
  // actions that never said. This used to read
  // `settings[...]?.mode || account.mode || a.type`, and since
  // LinkedInAccount.mode defaults to the non-empty string "auto", account.mode
  // always won and `a.type` was unreachable — which would have made every
  // step-level invite/message choice a silent no-op.
  const effectiveType = (a: (typeof picked)[number]) =>
    a.type && a.type !== "auto" ? a.type : settings[a.campaignId ?? ""]?.mode || account.mode || "auto";

  // Settle what each one is now that the settings have decided it: an "auto"
  // action queued as an invitation can go out as a message under a campaign's
  // own mode, and the Outbox and Reports have to count what was actually done.
  for (const kind of ["invite", "message"] as const) {
    const ids = picked.filter((a) => linkedinKind(effectiveType(a)) === kind).map((a) => a.id);
    if (ids.length) await prisma.linkedInAction.updateMany({ where: { id: { in: ids } }, data: { kind } });
  }

  return picked.map((a) => ({
    ...a,
    // Told per action rather than read from the extension's own settings, so the
    // switch lives in one place. Turning it off in the app stops the very next
    // action, with no need for the extension to notice a config change.
    autoSend: account.autoSend === true,
    type: effectiveType(a),
    leadName: [a.lead?.firstName, a.lead?.lastName].filter(Boolean).join(" ") || null,
  }));
}

/**
 * What a LinkedIn action does, in one word.
 *
 * Mirrors desktop/pilot.js exactly — `goal = action.type === "message" ? "message"
 * : "invite"` — because the desktop app decides from the type it was handed, and
 * "auto" never becomes a message there. The outcome code cannot stand in for this:
 * a sent message reports INVITATION_SUBMITTED as well.
 */
export function linkedinKind(type: string | null | undefined): "invite" | "message" {
  return type === "message" ? "message" : "invite";
}

/**
 * Extension reports the outcome. `"drafted"` is a non-terminal checkpoint — the tab is open
 * and filled, waiting on a human — so it only updates status, no CRM side effects yet.
 * `"sent"`/`"failed"`/`"skipped"` are terminal and reflected as a Message + activity (+
 * ConversationEvent) so they show up in the CRM.
 */
export async function completeAction(
  organizationId: string,
  input: {
    actionId: string;
    status: "sent" | "failed" | "skipped" | "drafted";
    result?: string;
    code?: string;
    /** What the client says it did. Absent from older clients; derived then. */
    kind?: "invite" | "message";
  }
) {
  const action = await prisma.linkedInAction.findFirst({ where: { id: input.actionId, organizationId } });
  if (!action) return null;

  // The client's own word first, then what it was told at claim time, then the
  // type it was queued with. Recorded on the row, because "how many invitations
  // did we send" is otherwise a question nobody can answer from the data.
  const kind = input.kind ?? (action.kind === "message" || action.kind === "invite" ? action.kind : linkedinKind(action.type));

  const updated = await prisma.linkedInAction.update({
    where: { id: action.id },
    data: {
      status: input.status,
      result: input.result?.slice(0, 300),
      sentAt: input.status === "sent" ? new Date() : null,
      kind,
    },
  });

  if (input.status === "drafted") return updated; // awaiting human review — nothing else to record yet

  if (input.status === "sent") {
    await prisma.message
      .create({
        data: {
          organizationId,
          leadId: action.leadId,
          campaignId: action.campaignId ?? undefined,
          channel: "linkedin",
          renderedBody: action.note,
          status: "sent",
          kind,
          idempotencyKey: randomUUID(),
          sentAt: new Date(),
        },
      })
      .catch(() => {});
    // Move the lead forward from "new" so the pipeline reflects the touch.
    await prisma.lead.updateMany({ where: { id: action.leadId, stage: "new" }, data: { stage: "contacted" } }).catch(() => {});
    await recordConversationEvent({
      organizationId,
      leadId: action.leadId,
      channel: "linkedin",
      direction: "outbound",
      body: action.note,
      status: "sent",
      externalId: action.id,
    });
  }

  await logActivity({
    organizationId,
    leadId: action.leadId,
    campaignId: action.campaignId ?? undefined,
    type: input.status === "sent" ? "linkedin_sent" : `linkedin_${input.status}`,
    channel: "linkedin",
    meta: { actionId: action.id, result: input.result, code: input.code, kind },
  });

  return updated;
}

/**
 * Mark invitations accepted, from a list of people who are now connections.
 *
 * LinkedIn tells nobody when an invitation is accepted — no API, no webhook, no
 * email we can read. What it does show is your connections list, newest first.
 * So whenever that list is read — the desktop app glancing at it at the start of
 * a run, the extension while you are on the page, a connections import — the
 * people on it are checked against invitations still waiting, and a match was
 * accepted.
 *
 * Claims nothing, so it cannot compete with the desktop app for work, and is
 * safe to call twice with the same list: `acceptedAt` is only ever set once.
 *
 * Matched on the profile's handle. An invitation sent to a different form of the
 * URL (a Sales Navigator id, a vanity URL renamed since) cannot be matched and
 * stays "awaiting" — this undercounts rather than inventing an acceptance.
 */
export async function recordConnectionsSeen(organizationId: string, profileUrls: string[]) {
  const { normalize } = await import("../identity");
  const seen = new Set(profileUrls.map((u) => normalize("linkedin", u)).filter((v): v is string => !!v));
  if (seen.size === 0) return { matched: 0 };

  // Invitations still waiting. Bounded by what LinkedIn allows — about twenty a
  // day per account — so even a long backlog is a small set.
  const waiting = await prisma.linkedInAction.findMany({
    where: {
      organizationId,
      status: "sent",
      acceptedAt: null,
      // Rows from before `kind` existed read as the desktop app treated them.
      OR: [{ kind: "invite" }, { kind: null, type: { not: "message" } }],
    },
    select: { id: true, leadId: true, campaignId: true, linkedinUrl: true },
    orderBy: { sentAt: "desc" },
    take: 5000,
  });

  const hits = waiting.filter((a) => {
    const key = normalize("linkedin", a.linkedinUrl);
    return !!key && seen.has(key);
  });

  let matched = 0;
  const at = new Date();
  for (const a of hits) {
    // Guarded on acceptedAt, so two clients reading the same list record it once.
    const { count } = await prisma.linkedInAction.updateMany({
      where: { id: a.id, acceptedAt: null },
      data: { acceptedAt: at },
    });
    if (!count) continue;
    matched++;
    await logActivity({
      organizationId,
      leadId: a.leadId,
      campaignId: a.campaignId ?? undefined,
      type: "invite_accepted",
      channel: "linkedin",
      meta: { actionId: a.id },
    });
    await recordConversationEvent({
      organizationId,
      leadId: a.leadId,
      channel: "linkedin",
      direction: "inbound",
      body: "Accepted your connection request",
      status: "accepted",
      externalId: `accepted:${a.id}`,
    });
  }
  return { matched };
}
