import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { normalize } from "@/lib/identity";
import { leadScope } from "@/lib/scope";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

const Body = z.object({ urls: z.array(z.string().max(500)).min(1).max(100) });

/**
 * POST /api/linkedin/lookup — which of these LinkedIn profiles are already in
 * Followthroo.
 *
 * Powers the "In Followthroo / Not in Followthroo" chip the extension shows on a
 * profile and beside each result, so somebody can tell before adding a person
 * twice rather than finding out from "1 already yours" afterwards.
 *
 * Existence is answered for the whole workspace: the import would merge the
 * duplicate anyway, and "already yours" is what the Add button already says. The
 * lead id — what "Open" needs — is returned only for contacts this member can
 * open. A link to a colleague's record would 404, and naming it would say more
 * than the Leads screen does.
 */
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail("Expected { urls: string[] }, up to 100.", 422));

  const { organizationId, userId } = account;

  // Normalised "linkedin.com/in/handle" → every URL, as sent, that maps to it.
  const sentByKey = new Map<string, string[]>();
  for (const raw of parsed.data.urls) {
    const key = normalize("linkedin", raw);
    if (!key) continue;
    sentByKey.set(key, [...(sentByKey.get(key) ?? []), raw]);
  }
  const keys = [...sentByKey.keys()];
  if (keys.length === 0) return withCors(ok({ results: {} }));

  // Two places a profile can be recorded. Contacts from LinkedIn imports and
  // webhooks carry a ContactIdentity; ones typed in or imported from a CSV only
  // have Lead.linkedinUrl, stored as it was written. Checking just the first
  // would call a CSV contact "not in Followthroo".
  const identities = await prisma.contactIdentity.findMany({
    where: { organizationId, kind: "linkedin", value: { in: keys } },
    select: { value: true, leadId: true },
  });
  const leadByKey = new Map(identities.map((i) => [i.value, i.leadId]));

  const missing = keys.filter((k) => !leadByKey.has(k));
  if (missing.length) {
    const candidates = await prisma.lead.findMany({
      where: {
        organizationId,
        OR: missing.map((k) => ({ linkedinUrl: { contains: k, mode: "insensitive" as const } })),
      },
      select: { id: true, linkedinUrl: true },
      take: 500,
    });
    // `contains` would let /in/jane match /in/janedoe, so confirm exactly.
    for (const c of candidates) {
      const key = c.linkedinUrl ? normalize("linkedin", c.linkedinUrl) : null;
      if (key && sentByKey.has(key) && !leadByKey.has(key)) leadByKey.set(key, c.id);
    }
  }

  const member = await prisma.member.findFirst({
    where: { organizationId, userId },
    select: { role: true, department: true },
  });
  const foundIds = [...new Set(leadByKey.values())];
  const visible = new Set<string>();
  if (member && foundIds.length) {
    const scope = await leadScope({ userId, orgId: organizationId, role: member.role, department: member.department });
    const rows = await prisma.lead.findMany({
      where: { AND: [scope.where, { id: { in: foundIds } }] },
      select: { id: true },
    });
    for (const r of rows) visible.add(r.id);
  }

  const results: Record<string, { inCrm: boolean; leadId: string | null }> = {};
  for (const [key, sent] of sentByKey) {
    const leadId = leadByKey.get(key) ?? null;
    for (const raw of sent) results[raw] = { inCrm: !!leadId, leadId: leadId && visible.has(leadId) ? leadId : null };
  }
  return withCors(ok({ results }));
}
