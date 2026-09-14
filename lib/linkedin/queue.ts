/**
 * LinkedIn action queue. Campaigns enqueue actions (the official API can't send
 * invites/DMs); the desktop app claims and performs them in the user's own
 * logged-in LinkedIn browser, then reports results. Daily caps, the note
 * allowance, credits and stale-claim recovery live here.
 *
 * Credits: an action is paid for when it's handed out and keeps what it paid
 * until the desktop app reports back — kept if it went, handed back if it
 * didn't. One put back in the queue (a browser closed mid-run, LinkedIn's note
 * upsell) keeps its credits, and isn't charged again when it's handed out next.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logActivity } from "../crm";
import { recordConversationEvent } from "../conversation";
import { randomUUID } from "node:crypto";
import { INVITE_NOTE_MAX } from "./note";
import { startOfOrgDay } from "../org-day";
import { spendable, unsettled } from "../billing/credits";
import { billingEnforced } from "../billing/limits";
import { charge, keepCredits, returnCredits } from "../billing/meter";
import { CREDIT_COSTS, linkedinCreditAction, type CreditAction } from "../billing/plans";

const STALE_MS = 15 * 60 * 1000; // reclaim actions stuck "in_progress" (browser closed mid-run)
const DRAFT_STALE_MS = 40 * 60 * 1000; // longer grace for "drafted" — a human has to actually read and act

/** Credits for an action are held under its own id. */
const CREDIT_REF = "linkedin_action";
const creditRef = (id: string) => ({ type: CREDIT_REF, id });

/**
 * How many invitations a day may carry a note on a free LinkedIn account.
 *
 * LinkedIn gives free accounts a handful of personalised notes and moves the
 * number now and then; three is what the desktop app has budgeted since notes
 * existed. It is where the day starts, not the authority — the day LinkedIn
 * shows its upsell sooner, `notesExhaustedOn` closes it early.
 */
export const FREE_NOTES_PER_DAY = 3;

export type NoteChoice = "yes" | "no" | "undecided";

/**
 * Whether this invitation goes out with its note.
 *
 * Rows queued before the choice existed carry no `noteChoice`, and they keep
 * doing what they always did: a note whenever there is one to send.
 */
export function resolveNoteChoice(a: { noteChoice: string | null; note: string | null }): NoteChoice {
  if (a.noteChoice === "yes" || a.noteChoice === "no" || a.noteChoice === "undecided") return a.noteChoice;
  return a.note ? "yes" : "no";
}

// The daily invite cap and the note allowance reset at the workspace's own
// midnight, the same moment plan credits do (lib/org-day.ts). Re-exported for
// the callers that already import it from here.
export { startOfOrgDay };

export async function enqueueLinkedInAction(input: {
  organizationId: string;
  leadId: string;
  linkedinUrl: string;
  note?: string | null;
  campaignId?: string | null;
  type?: string;
  /** Invitations only. Null keeps the old meaning: a note when there is one. */
  noteChoice?: NoteChoice | null;
}) {
  return prisma.linkedInAction.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      linkedinUrl: input.linkedinUrl,
      note: input.note ?? null,
      noteChoice: input.noteChoice ?? null,
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
  const startOfToday = await startOfOrgDay(organizationId);
  const [pending, sentToday, failedToday] = await Promise.all([
    prisma.linkedInAction.count({ where: { organizationId, status: "pending" } }),
    prisma.linkedInAction.count({ where: { organizationId, status: "sent", sentAt: { gte: startOfToday } } }),
    prisma.linkedInAction.count({ where: { organizationId, status: "failed", updatedAt: { gte: startOfToday } } }),
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
  /** free | premium | sales_navigator. Absent reads as free. */
  accountType?: string;
  /** When LinkedIn last said the notes were used up. */
  notesExhaustedOn?: Date | null;
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
 * Why an invitation that could otherwise go out is waiting.
 *
 * no_credits: the workspace has spent today's credits. It goes out once there
 * are credits again — at the workspace's midnight, or after a top-up.
 */
export type HoldReason = "needs_pick" | "no_notes_left" | "no_credits";

/**
 * Today's note allowance: what the account type allows, less what has gone out.
 *
 * "Gone out" counts invitations handed out with a note today, sent or still in
 * a browser, so a run in progress cannot be handed a fourth note on a free
 * account while the third is being typed. Once LinkedIn itself has said the
 * notes are used up, the allowance is zero for the rest of the day whatever
 * the setting says.
 */
export async function noteAllowance(account: ClaimAccount, startOfToday: Date) {
  const cap = (account.accountType ?? "free") === "free" ? FREE_NOTES_PER_DAY : account.dailyInviteCap;
  if (account.notesExhaustedOn && account.notesExhaustedOn >= startOfToday) {
    return { cap, left: 0, exhaustedByLinkedIn: true };
  }
  const used = await prisma.linkedInAction.count({
    where: {
      organizationId: account.organizationId,
      kind: "invite",
      status: { in: ["sent", "in_progress"] },
      updatedAt: { gte: startOfToday },
      OR: [{ noteChoice: "yes" }, { noteChoice: null, note: { not: null } }],
    },
  });
  return { cap, left: Math.max(0, cap - used), exhaustedByLinkedIn: false };
}

/**
 * What an action is when it's handed out.
 *
 * An explicit kind on the action is an instruction from the campaign step that
 * created it; the account/campaign mode is only a preference for actions that
 * never said. This used to read `settings[...]?.mode || account.mode || a.type`,
 * and since LinkedInAccount.mode defaults to the non-empty string "auto",
 * account.mode always won and `a.type` was unreachable — which would have made
 * every step-level invite/message choice a silent no-op.
 */
function effectiveType(account: ClaimAccount, a: { type: string; campaignId: string | null }) {
  const settings = (account.campaignSettings ?? {}) as Record<string, PerCampaign>;
  return a.type && a.type !== "auto" ? a.type : settings[a.campaignId ?? ""]?.mode || account.mode || "auto";
}

/** What handing an action out costs: an invitation 3, with a note 5, a message 2. */
function creditActionFor(
  account: ClaimAccount,
  a: { type: string; campaignId: string | null; noteChoice: string | null; note: string | null },
): CreditAction {
  const kind = linkedinKind(effectiveType(account, a));
  return linkedinCreditAction(kind, kind === "invite" && resolveNoteChoice(a) === "yes");
}

/**
 * The actions that are eligible right now, in the order they would be worked,
 * and the ones held back from them.
 *
 * Shared by `claimActions` (which then marks them in_progress) and `peekActions`
 * (which does not). That sharing is the whole point: the list shown to somebody
 * before they press Start has to be the list that actually goes out. Two
 * separate implementations of "which ones are eligible" would drift, and the
 * drift would only ever be discovered as invitations sent to the wrong people.
 */
async function selectClaimable(account: ClaimAccount, limit: number, opts: { wholeQueue?: boolean } = {}) {
  const organizationId = account.organizationId;
  const startOfToday = await startOfOrgDay(organizationId);
  const settings = (account.campaignSettings ?? {}) as Record<string, PerCampaign>;
  const selected = account.selectedCampaignIds ?? [];
  const metered = billingEnforced();

  const [usedGlobal, notes, credits] = await Promise.all([
    prisma.linkedInAction.count({
      where: { organizationId, status: { in: ["sent", "in_progress", "drafted"] }, updatedAt: { gte: startOfToday } },
    }),
    noteAllowance(account, startOfToday),
    // A read, not a charge: peekActions comes through here too, and looking at
    // the queue must never spend anything.
    metered ? spendable(organizationId) : null,
  ]);
  // The whole queue is for showing somebody what is waiting beyond today — the
  // LinkedIn screen, where notes are decided ahead of time. Claiming never asks
  // for it: today's cap is what keeps the account in good standing.
  const take = opts.wholeQueue ? limit : Math.min(Math.max(0, account.dailyInviteCap - usedGlobal), limit);
  if (take <= 0) return { picked: [], held: [], notes, credits };

  // Pull a small candidate window and filter in JS (handles campaign selection, per-campaign
  // caps, disabled campaigns, and run-a-book actions that have no campaignId).
  //
  // Invitations waiting for somebody's pick are left out of the window itself.
  // A "Leads I pick" campaign can queue a hundred of them, and counted here they
  // would fill the window and starve everything behind them.
  const candidates = await prisma.linkedInAction.findMany({
    where: {
      organizationId,
      status: "pending",
      OR: [{ noteChoice: null }, { noteChoice: { not: "undecided" } }],
    },
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

  // Handed out before and put back: these already hold their credits.
  const paidFor = metered ? await unsettled(organizationId, CREDIT_REF, candidates.map((a) => a.id)) : new Set<string>();

  const usedCache = new Map<string, number>();
  const usedFor = async (cid: string) => {
    if (!usedCache.has(cid)) {
      usedCache.set(cid, await prisma.linkedInAction.count({
        where: { organizationId, campaignId: cid, status: { in: ["sent", "in_progress", "drafted"] }, updatedAt: { gte: startOfToday } },
      }));
    }
    return usedCache.get(cid)!;
  };

  let notesLeft = notes.left;
  let creditsLeft = credits ? credits.total : Number.POSITIVE_INFINITY;
  const picked: typeof candidates = [];
  const held: { action: (typeof candidates)[number]; reason: HoldReason }[] = [];
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
    // Somebody chose a note for this person, so it waits for tomorrow's notes
    // rather than going out without one. Invitations without a note keep
    // flowing past it.
    const wantsNote = a.type !== "message" && resolveNoteChoice(a) === "yes";
    if (wantsNote && notesLeft <= 0) {
      held.push({ action: a, reason: "no_notes_left" });
      continue;
    }
    // Credits after notes, so an invitation already waiting for tomorrow's notes
    // isn't also counted as waiting for credits. A cheaper action behind one that
    // doesn't fit can still go — a message costs less than an invitation.
    const cost = paidFor.has(a.id) ? 0 : CREDIT_COSTS[creditActionFor(account, a)];
    if (cost > creditsLeft) {
      held.push({ action: a, reason: "no_credits" });
      continue;
    }
    creditsLeft -= cost;
    if (wantsNote) notesLeft--;
    picked.push(a);
  }
  return { picked, held, notes, credits };
}

/**
 * Release actions stranded by a browser that closed mid-run. Their credits stay
 * with them, so handing them out again charges nothing more.
 */
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

type Candidate = Awaited<ReturnType<typeof selectClaimable>>["picked"][number];

/**
 * Who is next, who is waiting and why, and how many notes are left today —
 * without touching anything.
 *
 * The desktop app shows this before a run so the person can see exactly who is
 * about to be contacted, and the LinkedIn screen shows it so they can decide
 * who gets a note. Deliberately read-only — no reclaim, no status change, no
 * charge — because looking at the queue must never consume it or change what
 * happens.
 */
export async function peekActions(account: ClaimAccount, limit: number, opts: { wholeQueue?: boolean } = {}) {
  const [{ picked, held, notes, credits }, waitingForPick] = await Promise.all([
    selectClaimable(account, limit, opts),
    prisma.linkedInAction.findMany({
      where: { organizationId: account.organizationId, status: "pending", noteChoice: "undecided" },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { lead: { select: LEAD_FOR_ACTION } },
    }),
  ]);
  const shape = (a: Candidate, hold: HoldReason | null) => ({
    id: a.id,
    type: a.type && a.type !== "auto" ? a.type : account.mode || "auto",
    linkedinUrl: a.linkedinUrl,
    note: a.note,
    noteChoice: resolveNoteChoice(a),
    hold,
    campaignId: a.campaignId,
    leadId: a.lead?.id ?? null,
    leadName: [a.lead?.firstName, a.lead?.lastName].filter(Boolean).join(" ") || null,
    company: a.lead?.company ?? null,
    title: a.lead?.title ?? null,
    stage: a.lead?.stage ?? null,
  });
  return {
    people: picked.map((a) => shape(a, null)),
    held: [
      ...waitingForPick.filter((a) => !a.lead?.optedOut).map((a) => shape(a, "needs_pick")),
      ...held.map((h) => shape(h.action, h.reason)),
    ],
    notes: { cap: notes.cap, left: notes.left, exhaustedByLinkedIn: notes.exhaustedByLinkedIn },
    /** Null while billing isn't enforced. */
    credits: credits ? { available: credits.total } : null,
  };
}

/**
 * Hand the desktop app its next batch of actions, honoring the account's config:
 * selected campaigns, the global daily cap, per-campaign caps, enabled flags,
 * the note allowance and credits. Each returned action carries its effective
 * `type` (auto/invite/message) and whether it goes with its note. Stale
 * in-progress actions are reclaimed first so a closed browser doesn't strand the
 * queue.
 */
export async function claimActions(account: ClaimAccount, limit: number) {
  await reclaimStale(account.organizationId);

  const { picked: eligible } = await selectClaimable(account, limit);
  if (eligible.length === 0) return [];

  // Paid for before it's handed out. selectClaimable already stopped where the
  // balance ran out; this is the charge itself, and where a race with another
  // spend is decided — an action that loses it simply isn't handed out this
  // time. One still holding credits from an earlier hand-out costs nothing more.
  const picked: typeof eligible = [];
  for (const a of eligible) {
    const paid = await charge(account.organizationId, creditActionFor(account, a), {
      ref: creditRef(a.id),
      meta: { leadId: a.leadId, campaignId: a.campaignId },
    });
    if (paid.ok) picked.push(a);
    else if (paid.reason === "no_plan") break;
  }
  if (picked.length === 0) return [];

  await prisma.linkedInAction.updateMany({
    where: { id: { in: picked.map((p) => p.id) } },
    data: { status: "in_progress" },
  });

  // Settle what each one is now that the settings have decided it: an "auto"
  // action queued as an invitation can go out as a message under a campaign's
  // own mode, and the Outbox and Reports have to count what was actually done.
  for (const kind of ["invite", "message"] as const) {
    const ids = picked.filter((a) => linkedinKind(effectiveType(account, a)) === kind).map((a) => a.id);
    if (ids.length) await prisma.linkedInAction.updateMany({ where: { id: { in: ids } }, data: { kind } });
  }

  return picked.map((a) => {
    const type = effectiveType(account, a);
    const invite = linkedinKind(type) === "invite";
    const withNote = invite && resolveNoteChoice(a) === "yes";
    return {
      ...a,
      // Told per action rather than read from the extension's own settings, so the
      // switch lives in one place. Turning it off in the app stops the very next
      // action, with no need for the extension to notice a config change.
      autoSend: account.autoSend === true,
      type,
      noteChoice: (withNote ? "yes" : "no") as NoteChoice,
      // An invitation marked "no" is not given its note at all, so a desktop app
      // too old to know the choice exists cannot type it anyway.
      note: invite && !withNote ? null : a.note,
      leadName: [a.lead?.firstName, a.lead?.lastName].filter(Boolean).join(" ") || null,
    };
  });
}

/**
 * LinkedIn showed its "you've used your free personalized invitations" upsell.
 *
 * That is a statement about the account for the rest of the day, not a failure
 * of this invitation: the action goes back to the queue with its note intact
 * (and its credits, so tomorrow's hand-out isn't charged again), and nothing
 * more is handed out with a note until tomorrow. Not recorded as an activity —
 * nothing happened to the lead.
 */
export async function noteLimitReached(accountId: string, organizationId: string, actionId: string, result?: string) {
  await prisma.linkedInAccount.update({ where: { id: accountId }, data: { notesExhaustedOn: new Date() } });
  const { count } = await prisma.linkedInAction.updateMany({
    where: { id: actionId, organizationId, status: "in_progress" },
    data: { status: "pending", result: (result ?? "waiting for tomorrow's notes").slice(0, 300) },
  });
  return count > 0;
}

/**
 * Change whether a queued invitation carries a note, or what the note says.
 *
 * Only while it is still pending. Once the desktop app has picked it up the
 * browser may already be typing, and an edit that lands after the note went out
 * would show a note nobody sent.
 */
export async function updateQueuedInvitation(
  organizationId: string,
  actionId: string,
  patch: { noteChoice?: "yes" | "no"; note?: string | null },
): Promise<{ ok: true; noteChoice: NoteChoice; note: string | null } | { ok: false; status: number; error: string }> {
  const action = await prisma.linkedInAction.findFirst({ where: { id: actionId, organizationId } });
  if (!action) return { ok: false, status: 404, error: "That invitation is no longer in the queue." };
  if (action.status !== "pending") {
    return { ok: false, status: 409, error: "The desktop app has already picked this one up." };
  }
  if (action.type === "message") return { ok: false, status: 400, error: "Only a connection request carries a note." };

  const note = patch.note === undefined ? action.note : patch.note?.trim() || null;
  if (note && note.length > INVITE_NOTE_MAX) {
    return { ok: false, status: 400, error: `LinkedIn allows ${INVITE_NOTE_MAX} characters in a note; this is ${note.length}.` };
  }
  const noteChoice = patch.noteChoice ?? action.noteChoice;
  if (resolveNoteChoice({ noteChoice, note }) === "yes" && !note) {
    return { ok: false, status: 400, error: "Write the note first — there's nothing to send." };
  }

  const { count } = await prisma.linkedInAction.updateMany({
    where: { id: actionId, organizationId, status: "pending" },
    data: { noteChoice, note },
  });
  if (!count) return { ok: false, status: 409, error: "The desktop app has already picked this one up." };
  return { ok: true, noteChoice: resolveNoteChoice({ noteChoice, note }), note };
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

/** What a sent action keeps: priced on what actually went out. */
function sentCost(kind: "invite" | "message", a: { noteChoice: string | null; note: string | null }) {
  return CREDIT_COSTS[linkedinCreditAction(kind, kind === "invite" && resolveNoteChoice(a) === "yes")];
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

  // Credits. Sent keeps what was paid at hand-out, priced on what actually went —
  // an "auto" invitation that went as a message keeps 2 of its 3 — and never
  // more than was paid. Failed and skipped hand it all back. Nothing puts a
  // finished action back in the queue, so this settles its ref for good; anything
  // that ever retries one will need a ref per attempt.
  if (billingEnforced()) {
    if (input.status === "sent") await keepCredits(organizationId, creditRef(action.id), sentCost(kind, action));
    else await returnCredits(organizationId, creditRef(action.id), `LinkedIn ${input.status}`);
  }

  if (input.status === "sent") {
    // What was actually sent: an invitation marked "no" went without its note.
    const body = kind === "invite" && resolveNoteChoice(action) !== "yes" ? null : action.note;
    await prisma.message
      .create({
        data: {
          organizationId,
          leadId: action.leadId,
          campaignId: action.campaignId ?? undefined,
          channel: "linkedin",
          renderedBody: body,
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
      body,
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
 * Settle credits nothing came back to settle.
 *
 * An action holds its credits from hand-out until the desktop app reports what
 * happened, and some never get that report: a campaign deleted, "Stop
 * everything" pressed, a lead deleted along with its queue. This finds
 * reservations still open on actions that have finished or gone, and settles
 * them the way completeAction would have. Actions still on their way are left
 * alone. Run by the billing sweep; safe to run any time.
 */
export async function settleStrandedCharges(opts: { organizationId?: string; olderThanMs?: number; limit?: number } = {}) {
  const { olderThanMs = 30 * 60_000, limit = 500 } = opts;
  const open = await prisma.$queryRaw<{ organizationId: string; refId: string }[]>(Prisma.sql`
    SELECT DISTINCT r."organizationId", r."refId"
    FROM "CreditLedger" r
    WHERE r."refType" = ${CREDIT_REF} AND r."kind" = 'reserve'
      AND r."createdAt" < ${new Date(Date.now() - olderThanMs)}
      AND r."createdAt" > ${new Date(Date.now() - 60 * 86_400_000)}
      ${opts.organizationId ? Prisma.sql`AND r."organizationId" = ${opts.organizationId}` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM "CreditLedger" s
        WHERE s."refType" = r."refType" AND s."refId" = r."refId" AND s."kind" <> 'reserve'
      )
    LIMIT ${limit}`);
  if (!open.length) return { checked: 0, kept: 0, returned: 0 };

  const actions = new Map(
    (
      await prisma.linkedInAction.findMany({
        where: { id: { in: open.map((o) => o.refId) } },
        select: { id: true, status: true, kind: true, type: true, note: true, noteChoice: true },
      })
    ).map((a) => [a.id, a]),
  );

  let kept = 0;
  let returned = 0;
  for (const { organizationId, refId } of open) {
    const a = actions.get(refId);
    if (a && (a.status === "pending" || a.status === "in_progress" || a.status === "drafted")) continue;
    if (a?.status === "sent") {
      const kind = a.kind === "message" || a.kind === "invite" ? a.kind : linkedinKind(a.type);
      await keepCredits(organizationId, creditRef(refId), sentCost(kind, a));
      kept++;
    } else {
      await returnCredits(organizationId, creditRef(refId), a ? `LinkedIn ${a.status}` : "the invitation was removed");
      returned++;
    }
  }
  return { checked: open.length, kept, returned };
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
 *
 * `autoEnrich`: the workspace's "look up contact info when an invitation is
 * accepted" setting (LinkedInAccount.autoEnrichOnAccept). Off by default —
 * queuing a lookup for every acceptance would spend the daily cap on people
 * nobody asked to look up.
 */
export async function recordConnectionsSeen(organizationId: string, profileUrls: string[], autoEnrich = false) {
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
    if (autoEnrich) {
      const { enqueueEnrichment } = await import("./enrich");
      await enqueueEnrichment({
        organizationId,
        leadId: a.leadId,
        linkedinUrl: a.linkedinUrl,
        source: "auto_accept",
        campaignId: a.campaignId,
      }).catch(() => {});
    }
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
