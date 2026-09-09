/**
 * Identity graph — resolve a person across email, phone, LinkedIn handle and any
 * future identifier onto ONE Lead.
 *
 * Every inbound adapter funnels through `resolveContact`, which is what stops a
 * person who submits a sales enquiry and later messages support from becoming
 * two contacts. Normalisation happens here, once, so equality on the stored
 * value is enough to resolve — no fuzzy matching at read time.
 */
import { prisma } from "./db";
import type { IdentityKind, Prisma } from "@prisma/client";

export type IdentityInput = { kind: IdentityKind; value: string };

/** Lowercase, strip the +alias, drop surrounding whitespace. */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  return v;
}

/**
 * Best-effort E.164. Indian numbers arrive as `9876543210`, `09876543210`,
 * `+91 98765 43210` and `91-9876543210` from different aggregators; all four
 * must land on the same identity.
 */
export function normalizePhone(raw: string, defaultCountry = "91"): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) return d.length >= 8 ? d : null;
  d = d.replace(/^0+/, "");
  // A bare national number gets the default country code.
  if (d.length === 10) d = defaultCountry + d;
  return d.length >= 10 ? `+${d}` : null;
}

/** Canonical `linkedin.com/in/handle`, casing and tracking params discarded. */
export function normalizeLinkedIn(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const m = v.match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/);
  if (m) return `linkedin.com/in/${m[1]}`;
  if (/^[a-z0-9-]{3,}$/.test(v)) return `linkedin.com/in/${v}`;
  return null;
}

export function normalize(kind: IdentityKind, value: string): string | null {
  switch (kind) {
    case "email": return normalizeEmail(value);
    case "phone": return normalizePhone(value);
    case "linkedin": return normalizeLinkedIn(value);
    default: return value.trim() || null;
  }
}

/** Drops unparseable values rather than storing junk that can never match. */
export function normalizeAll(inputs: IdentityInput[]): IdentityInput[] {
  const out: IdentityInput[] = [];
  const seen = new Set<string>();
  for (const i of inputs) {
    const value = normalize(i.kind, i.value);
    if (!value) continue;
    const key = `${i.kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: i.kind, value });
  }
  return out;
}

export type ResolveInput = {
  organizationId: string;
  identities: IdentityInput[];
  /** Applied only when creating, or filling a blank on an existing contact. */
  profile?: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    title?: string | null;
  };
  sourceKey?: string;
  /** Adapter name, recorded against each new identifier. */
  source?: string;
};

export type ResolveResult = {
  leadId: string;
  created: boolean;
  /** Leads folded into the survivor because this payload linked them. */
  mergedLeadIds: string[];
  matchedOn: IdentityInput[];
};

/**
 * Resolve — or create — the single Lead these identifiers belong to.
 *
 * When one payload carries identifiers that currently point at DIFFERENT leads
 * (a phone we knew and an email we knew, never before seen together), that is
 * new evidence they are the same person, so the records are merged rather than
 * left as silent duplicates. The oldest lead survives, since it owns the most
 * history.
 */
export async function resolveContact(input: ResolveInput): Promise<ResolveResult> {
  const { organizationId, sourceKey, source } = input;
  const identities = normalizeAll(input.identities);
  if (identities.length === 0) throw new Error("resolveContact: no usable identifiers");

  const existing = await prisma.contactIdentity.findMany({
    where: { organizationId, OR: identities.map((i) => ({ kind: i.kind, value: i.value })) },
    select: { leadId: true, kind: true, value: true },
  });

  const leadIds = [...new Set(existing.map((e) => e.leadId))];
  const sourceId = sourceKey ? await ensureSource(organizationId, sourceKey) : null;

  // --- nothing known: create -------------------------------------------------
  if (leadIds.length === 0) {
    const email = identities.find((i) => i.kind === "email")?.value ?? null;
    const phone = identities.find((i) => i.kind === "phone")?.value ?? null;
    const linkedinUrl = identities.find((i) => i.kind === "linkedin")?.value ?? null;

    const lead = await prisma.lead.create({
      data: {
        organizationId,
        email,
        phone,
        linkedinUrl: linkedinUrl ? `https://${linkedinUrl}` : null,
        firstName: input.profile?.firstName ?? null,
        lastName: input.profile?.lastName ?? null,
        company: input.profile?.company ?? null,
        title: input.profile?.title ?? null,
        leadSourceId: sourceId,
        contactIdentities: {
          create: identities.map((i) => ({ organizationId, kind: i.kind, value: i.value, source })),
        },
      },
      select: { id: true },
    });
    return { leadId: lead.id, created: true, mergedLeadIds: [], matchedOn: [] };
  }

  // --- known: pick the oldest as survivor ------------------------------------
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, createdAt: true, firstName: true, lastName: true, company: true, title: true, leadSourceId: true },
    orderBy: { createdAt: "asc" },
  });
  const survivor = leads[0];
  const losers = leads.slice(1).map((l) => l.id);

  if (losers.length > 0) await mergeLeads(organizationId, survivor.id, losers);

  // Attach any identifier we had not seen before.
  const known = new Set(existing.map((e) => `${e.kind}:${e.value}`));
  const fresh = identities.filter((i) => !known.has(`${i.kind}:${i.value}`));
  if (fresh.length > 0) {
    await prisma.contactIdentity.createMany({
      data: fresh.map((i) => ({ organizationId, leadId: survivor.id, kind: i.kind, value: i.value, source })),
      skipDuplicates: true,
    });
  }

  // Fill blanks only — never overwrite a value a human has already curated.
  const patch: Prisma.LeadUpdateInput = {};
  if (!survivor.firstName && input.profile?.firstName) patch.firstName = input.profile.firstName;
  if (!survivor.lastName && input.profile?.lastName) patch.lastName = input.profile.lastName;
  if (!survivor.company && input.profile?.company) patch.company = input.profile.company;
  if (!survivor.title && input.profile?.title) patch.title = input.profile.title;
  if (!survivor.leadSourceId && sourceId) patch.leadSource = { connect: { id: sourceId } };
  if (Object.keys(patch).length > 0) {
    await prisma.lead.update({ where: { id: survivor.id }, data: patch });
  }

  return {
    leadId: survivor.id,
    created: false,
    mergedLeadIds: losers,
    matchedOn: existing.map((e) => ({ kind: e.kind, value: e.value })),
  };
}

/**
 * Fold duplicates into the survivor. Child rows are repointed rather than
 * deleted — the whole purpose of merging is that history survives.
 */
export async function mergeLeads(organizationId: string, survivorId: string, loserIds: string[]) {
  if (loserIds.length === 0) return;
  const where = { leadId: { in: loserIds } };

  // Salvage scalar fields before the losers are deleted. A merge must never
  // lose information: if the survivor knows no company and the duplicate did,
  // that company is real and the only copy of it is about to be removed.
  const [survivor, losers] = await Promise.all([
    prisma.lead.findUnique({ where: { id: survivorId } }),
    prisma.lead.findMany({ where: { id: { in: loserIds } }, orderBy: { createdAt: "asc" } }),
  ]);
  if (survivor) {
    const patch: Record<string, unknown> = {};
    const fields = ["firstName", "lastName", "email", "phone", "linkedinUrl", "company", "title", "leadSourceId"] as const;
    for (const f of fields) {
      if (survivor[f]) continue;
      const donor = losers.find((l) => l[f]);
      if (donor) patch[f] = donor[f];
    }
    // Tags and custom fields union rather than overwrite — both sides are real.
    const tags = new Set(survivor.tags);
    losers.forEach((l) => l.tags.forEach((t) => tags.add(t)));
    if (tags.size !== survivor.tags.length) patch.tags = [...tags];

    const custom = { ...(survivor.custom as object) };
    for (const l of losers) Object.assign(custom, l.custom as object, custom);
    if (Object.keys(custom).length !== Object.keys(survivor.custom as object).length) patch.custom = custom;

    // An opt-out on either record wins — consent is the conservative direction.
    if (!survivor.optedOut && losers.some((l) => l.optedOut)) patch.optedOut = true;

    if (Object.keys(patch).length > 0) {
      await prisma.lead.update({ where: { id: survivorId }, data: patch });
    }
  }

  await prisma.$transaction([
    prisma.contactIdentity.updateMany({ where, data: { leadId: survivorId } }),
    prisma.conversationEvent.updateMany({ where, data: { leadId: survivorId } }),
    prisma.message.updateMany({ where, data: { leadId: survivorId } }),
    prisma.activityLog.updateMany({ where, data: { leadId: survivorId } }),
    prisma.inboxThread.updateMany({ where, data: { leadId: survivorId } }),
    // Tasks and notes cascade on lead delete, so they MUST be repointed before
    // the losers are removed below — otherwise merging silently destroys the
    // follow-up someone scheduled and the notes they wrote.
    prisma.task.updateMany({ where, data: { leadId: survivorId } }),
    prisma.note.updateMany({ where, data: { leadId: survivorId } }),
  ]);

  // Enrollments and pipeline items are unique per (campaign|pipeline, lead), so
  // a blind update would collide. Move only the ones the survivor lacks.
  const [enrollments, items] = await Promise.all([
    prisma.enrollment.findMany({ where, select: { id: true, campaignId: true } }),
    prisma.pipelineItem.findMany({ where, select: { id: true, pipelineId: true } }),
  ]);

  for (const e of enrollments) {
    const clash = await prisma.enrollment.findFirst({
      where: { campaignId: e.campaignId, leadId: survivorId },
      select: { id: true },
    });
    if (clash) await prisma.enrollment.delete({ where: { id: e.id } });
    else await prisma.enrollment.update({ where: { id: e.id }, data: { leadId: survivorId } });
  }
  for (const it of items) {
    const clash = await prisma.pipelineItem.findFirst({
      where: { pipelineId: it.pipelineId, leadId: survivorId },
      select: { id: true },
    });
    if (clash) await prisma.pipelineItem.delete({ where: { id: it.id } });
    else await prisma.pipelineItem.update({ where: { id: it.id }, data: { leadId: survivorId } });
  }

  await prisma.lead.deleteMany({ where: { id: { in: loserIds }, organizationId } });
}

const SOURCE_LABELS: Record<string, string> = {
  meta_lead_ads: "Meta Lead Ads",
  google_ads: "Google Ads",
  indiamart: "IndiaMART",
  justdial: "JustDial",
  web_form: "Website form",
  manual: "Added by hand",
  csv: "CSV import",
  email: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
};

/** Sources are created on first sighting so no configuration precedes a lead. */
export async function ensureSource(organizationId: string, key: string): Promise<string> {
  const existing = await prisma.leadSource.findUnique({
    where: { organizationId_key: { organizationId, key } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.leadSource.create({
    data: { organizationId, key, label: SOURCE_LABELS[key] ?? key },
    select: { id: true },
  });
  return created.id;
}

