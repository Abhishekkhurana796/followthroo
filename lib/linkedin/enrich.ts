/**
 * Enrichment: email and phone from a 1st-degree connection's LinkedIn Contact
 * info, read by the desktop app and merged into the CRM.
 *
 * Shares every structural rule with lib/linkedin/queue.ts, because it is the
 * same kind of thing — work claimed by exactly one client (the desktop app),
 * paced against a daily cap, paid for in credits reserved at claim and settled
 * on completion:
 *
 *   - One claimer, always. `claimEnrichments` marks a row `in_progress` with a
 *     single atomic UPDATE, never a read then a write.
 *   - Credits are reserved when a row is claimed and settled when it's
 *     completed — kept for what was actually found, handed back for a
 *     technical failure or a lead who isn't a 1st-degree connection.
 *   - A campaign's Enrich step parks the enrollment rather than polling: see
 *     `resumeAfterEnrich`, called from here, and the `enrich` node case in
 *     campaign-engine.ts.
 */
import { prisma } from "../db";
import { logActivity } from "../crm";
import { charge, keepCredits, returnCredits } from "../billing/meter";
import { billingEnforced } from "../billing/limits";
import { enrichmentCharge } from "../billing/plans";
import { startOfOrgDay } from "../org-day";

const STALE_MS = 20 * 60 * 1000; // a browser closed mid-lookup
const MAX_ATTEMPTS = 3;

const CREDIT_REF = "linkedin_enrichment";
const creditRef = (id: string) => ({ type: CREDIT_REF, id });

export type EnrichSource = "manual" | "bulk" | "campaign" | "auto_accept";

/**
 * Queue a lookup for one lead, unless one is already open.
 *
 * Dedupes on (leadId, status in pending/in_progress) rather than on the whole
 * row: a lead already waiting for a lookup does not need a second one queued
 * from a different place (the Leads bulk action and an auto-accept racing,
 * say) — that would only spend the daily cap twice on the same person.
 */
export async function enqueueEnrichment(input: {
  organizationId: string;
  leadId: string;
  linkedinUrl: string;
  source: EnrichSource;
  campaignId?: string | null;
  enrollmentId?: string | null;
  nodeId?: string | null;
}) {
  const open = await prisma.linkedInEnrichment.findFirst({
    where: { organizationId: input.organizationId, leadId: input.leadId, status: { in: ["pending", "in_progress"] } },
  });
  if (open) return open;
  return prisma.linkedInEnrichment.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      linkedinUrl: input.linkedinUrl,
      source: input.source,
      campaignId: input.campaignId ?? null,
      enrollmentId: input.enrollmentId ?? null,
      nodeId: input.nodeId ?? null,
      status: "pending",
    },
  });
}

/** Release lookups stranded by a browser that closed mid-way. Their credits stay with them. */
async function reclaimStale(organizationId: string) {
  await prisma.linkedInEnrichment.updateMany({
    where: { organizationId, status: "in_progress", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "pending" },
  });
}

export interface ClaimEnrichAccount {
  organizationId: string;
  dailyEnrichCap: number;
}

/**
 * Hand the desktop app its next batch of lookups: paid for as they're handed
 * out, capped per account per day, at most `limit` at a time.
 *
 * Runs after the invite lane in `runner.js` — the daily cap here is
 * deliberately much smaller than the invite cap, because opening a profile's
 * Contact info all day is exactly the pattern LinkedIn's abuse detection
 * watches for.
 */
export async function claimEnrichments(account: ClaimEnrichAccount, limit: number) {
  await reclaimStale(account.organizationId);
  const startOfToday = await startOfOrgDay(account.organizationId);

  const usedToday = await prisma.linkedInEnrichment.count({
    where: { organizationId: account.organizationId, status: { in: ["in_progress", "done", "skipped", "failed"] }, updatedAt: { gte: startOfToday } },
  });
  const room = Math.max(0, Math.min(account.dailyEnrichCap - usedToday, limit));
  if (room <= 0) return [];

  const candidates = await prisma.linkedInEnrichment.findMany({
    where: { organizationId: account.organizationId, status: "pending" },
    orderBy: { createdAt: "asc" },
    take: room,
    include: { lead: { select: { id: true, firstName: true, lastName: true, optedOut: true } } },
  });

  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (c.lead?.optedOut) {
      // Consent outranks everything, same as the invite queue. Not a lookup
      // that failed — it should never have been queued, so it costs nothing
      // and leaves no trace.
      await prisma.linkedInEnrichment.update({ where: { id: c.id }, data: { status: "skipped", result: "opted out" } });
      continue;
    }
    if (billingEnforced()) {
      const paid = await charge(account.organizationId, "enrich", { ref: creditRef(c.id), meta: { leadId: c.leadId } });
      if (!paid.ok) break; // no plan, or the day's credits are gone — stop handing out more
    }
    picked.push(c);
  }
  if (!picked.length) return [];

  await prisma.linkedInEnrichment.updateMany({ where: { id: { in: picked.map((p) => p.id) } }, data: { status: "in_progress" } });

  return picked.map((c) => ({
    id: c.id,
    leadId: c.leadId,
    linkedinUrl: c.linkedinUrl,
    leadName: [c.lead?.firstName, c.lead?.lastName].filter(Boolean).join(" ") || null,
    attempts: c.attempts,
  }));
}

export interface EnrichReport {
  enrichmentId: string;
  /** What the desktop app read. Absent (or "not_connected"/"failed") means nothing was opened. */
  degree?: "1st" | "2nd" | "3rd" | "out_of_network" | null;
  status: "done" | "skipped" | "failed";
  email?: string | null;
  phone?: string | null;
  extra?: Record<string, unknown>;
  result?: string;
}

/**
 * Merge a found value into the CRM without clobbering what's already there.
 *
 * The plan is explicit: existing CRM data wins as the primary value, and
 * LinkedIn's is added as an extra, marked "from LinkedIn" — never silently
 * overwritten, and never duplicated if it's the same value.
 */
async function mergeContact(organizationId: string, leadId: string, kind: "email" | "phone", value: string, currentPrimary: string | null) {
  const norm = kind === "email" ? value.trim().toLowerCase() : value.replace(/[^\d+]/g, "");
  if (!norm) return;
  if (currentPrimary && currentPrimary.trim().toLowerCase() === norm) return; // same value — nothing to add
  if (!currentPrimary) {
    await prisma.lead.update({ where: { id: leadId }, data: { [kind]: value } });
    return;
  }
  await prisma.contactIdentity
    .upsert({
      where: { organizationId_kind_value: { organizationId, kind, value: norm } },
      create: { organizationId, leadId, kind, value: norm, source: "linkedin_enrichment" },
      update: {},
    })
    .catch(() => {}); // a value already claimed by another lead's identity graph is left alone
}

/**
 * The desktop app reports what one lookup found. Settles credits, merges the
 * CRM, and — for a lookup queued by a campaign's Enrich step — moves that
 * enrollment on immediately rather than waiting for its 7-day timeout.
 */
export async function completeEnrichment(organizationId: string, report: EnrichReport) {
  const row = await prisma.linkedInEnrichment.findFirst({ where: { id: report.enrichmentId, organizationId } });
  if (!row) return null;

  const connected = report.degree === "1st";
  const failed = report.status === "failed";

  // A technical failure (profile gone, page changed under us) gets retried a
  // few times before it's treated as done-for-now; "not a connection" is not
  // a failure at all — it is the correct, final answer for that lead today.
  if (failed && row.attempts + 1 < MAX_ATTEMPTS) {
    await prisma.linkedInEnrichment.update({
      where: { id: row.id },
      data: { status: "pending", attempts: row.attempts + 1, result: report.result?.slice(0, 300) },
    });
    if (billingEnforced()) await returnCredits(organizationId, creditRef(row.id), "will retry");
    return { retrying: true };
  }

  const charged = billingEnforced()
    ? enrichmentCharge({ connected, failed, foundEmail: !!report.email, foundPhone: !!report.phone })
    : 0;

  await prisma.linkedInEnrichment.update({
    where: { id: row.id },
    data: {
      status: failed ? "failed" : connected ? "done" : "skipped",
      attempts: row.attempts + 1,
      degree: report.degree ?? null,
      foundEmail: report.email ?? null,
      foundPhone: report.phone ?? null,
      extra: (report.extra ?? {}) as object,
      creditsCharged: charged,
      result: report.result?.slice(0, 300),
      completedAt: new Date(),
    },
  });

  if (billingEnforced()) {
    if (charged > 0) await keepCredits(organizationId, creditRef(row.id), charged);
    else await returnCredits(organizationId, creditRef(row.id), failed ? "lookup failed" : "not a 1st-degree connection");
  }

  if (connected && (report.email || report.phone)) {
    const lead = await prisma.lead.findUnique({ where: { id: row.leadId }, select: { email: true, phone: true } });
    if (report.email) await mergeContact(organizationId, row.leadId, "email", report.email, lead?.email ?? null);
    if (report.phone) await mergeContact(organizationId, row.leadId, "phone", report.phone, lead?.phone ?? null);
  }

  await logActivity({
    organizationId,
    leadId: row.leadId,
    campaignId: row.campaignId ?? undefined,
    type: "lead_enriched",
    channel: "linkedin",
    meta: { enrichmentId: row.id, degree: report.degree, foundEmail: !!report.email, foundPhone: !!report.phone, credits: charged },
  });

  // A campaign's Enrich step parked the enrollment on this exact node; moving
  // it on the moment the lookup finishes is what makes "has email" usable in
  // the very next step, instead of waiting up to 7 days for the timeout.
  if (row.enrollmentId && row.nodeId) {
    const { resumeAfterEnrich } = await import("../campaign-engine");
    await resumeAfterEnrich(row.enrollmentId, row.nodeId).catch((e) =>
      console.error("[enrich] resuming the campaign after a lookup failed:", e),
    );
  }

  return { retrying: false, charged };
}

/** Cheap read for a confirm dialog: how many of these leads a lookup would actually run for. */
export async function estimateEnrichment(organizationId: string, leadIds: string[]) {
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, organizationId },
    select: { id: true, linkedinUrl: true, optedOut: true },
  });
  const alreadyQueued = await prisma.linkedInEnrichment.count({
    where: { organizationId, leadId: { in: leadIds }, status: { in: ["pending", "in_progress"] } },
  });
  const eligible = leads.filter((l) => l.linkedinUrl && !l.optedOut).length;
  return {
    eligible,
    noLinkedIn: leads.length - eligible - leads.filter((l) => l.optedOut).length,
    optedOut: leads.filter((l) => l.optedOut).length,
    alreadyQueued,
  };
}
