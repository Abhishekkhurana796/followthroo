/**
 * What the billing screens show about a workspace: its plan and where that
 * stands, today's credits and what they went on, how much of each limit it
 * uses, and the history of every charge and refund.
 *
 * Read-only. Opening Billing, or the credits chip in the sidebar, never spends
 * or grants anything.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { orgOffsetMinutes } from "../org-day";
import { spendable } from "./credits";
import { billingEnforced, limitUsage } from "./limits";
import type { CreditAction } from "./plans";
import { canSpend, workspacePlan } from "./subscription";

const DAY_MS = 86_400_000;

/** Charges, named in the plural for today's breakdown. */
const SPENT_ON: Record<CreditAction, string> = {
  email_send: "Emails",
  li_invite: "Invitations",
  li_invite_note: "Invitations with a note",
  li_message: "LinkedIn messages",
  enrich: "Enrichment",
  whatsapp_send: "WhatsApp messages",
  sms_send: "Text messages",
  ai_draft: "AI drafts",
  ai_post_standard: "AI posts",
  ai_post_premium: "AI posts, premium model",
  li_sourcing: "LinkedIn imports",
};

/** …and in the singular, for one line of history. */
const ONE: Record<CreditAction, string> = {
  email_send: "Email",
  li_invite: "Invitation",
  li_invite_note: "Invitation with a note",
  li_message: "LinkedIn message",
  enrich: "Enrichment",
  whatsapp_send: "WhatsApp message",
  sms_send: "Text message",
  ai_draft: "AI draft",
  ai_post_standard: "AI post",
  ai_post_premium: "AI post, premium model",
  li_sourcing: "LinkedIn import",
};

/** "IST" for the default offset, otherwise "UTC+4" or "UTC−3:30". */
export function zoneLabel(offsetMinutes: number) {
  if (offsetMinutes === 330) return "IST";
  if (offsetMinutes === 0) return "UTC";
  const abs = Math.abs(offsetMinutes);
  const mins = abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : "";
  return `UTC${offsetMinutes > 0 ? "+" : "−"}${Math.floor(abs / 60)}${mins}`;
}

export type BillingSummary = Awaited<ReturnType<typeof billingSummary>>;

export async function billingSummary(organizationId: string) {
  const [wp, credits, offset, limits] = await Promise.all([
    workspacePlan(organizationId),
    spendable(organizationId),
    orgOffsetMinutes(organizationId),
    limitUsage(organizationId),
  ]);
  const local = Date.now() + offset * 60_000;
  const startOfDay = new Date(Math.floor(local / DAY_MS) * DAY_MS - offset * 60_000);

  // What today's credits went on: each charge net of anything handed back, so a
  // failed invitation doesn't count and an enrichment that found no phone counts 2.
  const today = await prisma.creditLedger.findMany({
    where: { organizationId, createdAt: { gte: startOfDay }, kind: { in: ["reserve", "release", "refund"] } },
    select: { action: true, refType: true, refId: true, amount: true },
  });
  const perThing = new Map<string, { action: string; net: number }>();
  for (const row of today) {
    if (!row.action) continue;
    const key = `${row.refType}:${row.refId}`;
    const entry = perThing.get(key) ?? { action: row.action, net: 0 };
    entry.net += row.amount;
    perThing.set(key, entry);
  }
  const perAction = new Map<string, { count: number; credits: number }>();
  for (const { action, net } of perThing.values()) {
    if (net >= 0) continue;
    const entry = perAction.get(action) ?? { count: 0, credits: 0 };
    entry.count++;
    entry.credits -= net;
    perAction.set(action, entry);
  }

  const allowance = canSpend(wp) ? (wp.plan?.dailyCredits ?? 0) : 0;
  return {
    enforced: billingEnforced(),
    plan: wp.plan
      ? {
          id: wp.plan.id,
          name: wp.plan.name,
          price: wp.plan.price,
          billing: wp.plan.billing,
          dailyCredits: wp.plan.dailyCredits,
          topUps: wp.plan.topUps,
        }
      : null,
    access: wp.access,
    status: wp.status,
    endsAt: wp.endsAt,
    daysLeft: wp.daysLeft,
    credits: {
      allowance,
      left: Math.min(credits.daily, allowance),
      used: Math.max(0, allowance - credits.daily),
      topup: credits.topup,
      resetsAt: new Date(startOfDay.getTime() + DAY_MS),
      zone: zoneLabel(offset),
      spent: [...perAction]
        .map(([action, v]) => ({ action, label: SPENT_ON[action as CreditAction] ?? action, ...v }))
        .sort((a, b) => b.credits - a.credits),
    },
    limits,
  };
}

export interface HistoryEntry {
  id: string;
  /** When it started: the charge, the grant or the payment. */
  at: Date;
  label: string;
  detail: string | null;
  /** Net: negative for credits spent, positive for credits added. */
  credits: number;
  /** Still reserved for something that hasn't finished. */
  pending: boolean;
}

/**
 * Every charge, refund, daily grant and top-up, newest first, one line per thing
 * rather than per ledger row: an invitation's reservation and its refund read as
 * one "Invitation · Neha Iyer, nothing charged". A campaign's emails in the same
 * hour fold into one line, or a busy day would be a thousand rows of "Email".
 *
 * Paged on when each thing started: pass the last entry's `at` as `before`.
 */
export async function creditHistory(organizationId: string, opts: { before?: Date; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const things = await prisma.$queryRaw<{ refType: string; refId: string }[]>(Prisma.sql`
    SELECT "refType", "refId"
    FROM "CreditLedger"
    WHERE "organizationId" = ${organizationId}
      AND "createdAt" > ${new Date(Date.now() - 90 * DAY_MS)}
      AND "kind" <> 'capture'
    GROUP BY "refType", "refId"
    HAVING min("createdAt") < ${opts.before ?? new Date(Date.now() + DAY_MS)}
    ORDER BY min("createdAt") DESC
    LIMIT ${limit}`);
  if (!things.length) return { entries: [] as HistoryEntry[], next: null as Date | null };

  const rows = await prisma.creditLedger.findMany({
    where: { organizationId, OR: things.map((t) => ({ refType: t.refType, refId: t.refId })) },
    orderBy: { createdAt: "asc" },
  });

  type Thing = {
    id: string;
    refType: string;
    at: Date;
    action: string | null;
    kinds: Set<string>;
    reserved: number;
    returned: number;
    added: number;
    reason: string | null;
    leadId: string | null;
    campaignId: string | null;
  };
  const byThing = new Map<string, Thing>();
  for (const row of rows) {
    const key = `${row.refType}:${row.refId}`;
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const t =
      byThing.get(key) ??
      ({
        id: key,
        refType: row.refType,
        at: row.createdAt,
        action: row.action,
        kinds: new Set<string>(),
        reserved: 0,
        returned: 0,
        added: 0,
        reason: null,
        leadId: null,
        campaignId: null,
      } satisfies Thing);
    t.kinds.add(row.kind);
    if (row.kind === "reserve") t.reserved -= row.amount;
    else if (row.kind === "release" || row.kind === "refund") t.returned += row.amount;
    else if (row.kind !== "capture") t.added += row.amount;
    if (typeof meta.reason === "string") t.reason = meta.reason;
    if (typeof meta.leadId === "string") t.leadId = meta.leadId;
    if (typeof meta.campaignId === "string") t.campaignId = meta.campaignId;
    byThing.set(key, t);
  }

  const leadIds = [...new Set([...byThing.values()].map((t) => t.leadId).filter((v): v is string => !!v))];
  const campaignIds = [...new Set([...byThing.values()].map((t) => t.campaignId).filter((v): v is string => !!v))];
  const [leads, campaigns] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({ where: { id: { in: leadIds }, organizationId }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [],
    campaignIds.length ? prisma.campaign.findMany({ where: { id: { in: campaignIds }, organizationId }, select: { id: true, name: true } }) : [],
  ]);
  const leadName = new Map(leads.map((l) => [l.id, [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "a contact"]));
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));

  const entries: HistoryEntry[] = [];
  for (const t of [...byThing.values()].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    const net = t.added + t.returned - t.reserved;
    const settled = t.kinds.has("capture") || t.kinds.has("release") || t.kinds.has("refund");
    const isSend = t.action === "email_send" || t.action === "whatsapp_send" || t.action === "sms_send";

    if (t.kinds.has("grant")) {
      entries.push({ id: t.id, at: t.at, label: "Daily credits", detail: null, credits: net, pending: false });
      continue;
    }
    if (t.kinds.has("topup")) {
      entries.push({ id: t.id, at: t.at, label: "Top-up", detail: `${t.added.toLocaleString("en-US")} credits`, credits: net, pending: false });
      continue;
    }
    // A send handed straight back — rate-limited, suppressed, a bounce at the
    // door — cost nothing and happened to nobody. Listing each would bury the
    // history in noise.
    if (isSend && settled && net === 0) continue;

    // Fold a campaign's sends from the same hour into the line above it.
    const previous = entries[entries.length - 1];
    const hour = Math.floor(t.at.getTime() / 3_600_000);
    if (
      isSend &&
      previous &&
      previous.id.startsWith(`sends:${t.action}:${t.campaignId ?? "-"}:${hour}:`) &&
      !previous.pending
    ) {
      const count = Number(previous.detail?.split(" ")[0] ?? 1) + 1;
      previous.detail = `${count} sent`;
      previous.credits += net;
      previous.at = t.at;
      continue;
    }

    const action = (t.action ?? "") as CreditAction;
    const who = t.leadId ? leadName.get(t.leadId) : null;
    const where = t.campaignId ? campaignName.get(t.campaignId) : null;
    const label = isSend
      ? `${SPENT_ON[action] ?? "Sends"}${where ? ` · ${where}` : ""}`
      : `${ONE[action] ?? "Charge"}${who ? ` · ${who}` : where ? ` · ${where}` : ""}`;
    const detail = !settled
      ? "Waiting to go out — credits are held until it does"
      : isSend
        ? "1 sent"
        : t.returned && net === 0
          ? `Nothing charged${t.reason ? ` (${t.reason})` : ""}`
          : t.returned
            ? `${t.reserved} charged, ${t.returned} back${t.reason ? ` (${t.reason})` : ""}`
            : null;
    entries.push({
      id: isSend && settled ? `sends:${t.action}:${t.campaignId ?? "-"}:${hour}:${t.id}` : t.id,
      at: t.at,
      label,
      detail,
      credits: settled ? net : -t.reserved,
      pending: !settled,
    });
  }

  return { entries, next: things.length === limit ? rows[0]?.createdAt ?? null : null };
}
