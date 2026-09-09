import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { invalidate } from "@/lib/cache";
import { recomputeAndSaveLeadScore } from "@/lib/scoring";
import { getLeadDetail } from "@/lib/queries";
import { leadScope } from "@/lib/scope";
import { suppress } from "@/lib/crm";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Fields the client is allowed to PATCH (never id / organizationId / relations).
const PATCHABLE = new Set([
  "firstName", "lastName", "email", "phone", "linkedinUrl", "company", "title", "stage", "tags", "custom", "optedOut", "consent",
  // Scoring v1 qualifying signals (product PRD §6) — manually set for now.
  "budgetMentioned", "timelineMentioned", "decisionMakerConfirmed",
]);
const SCORE_SIGNALS = new Set(["budgetMentioned", "timelineMentioned", "decisionMakerConfirmed"]);

// The full contact record the lead page renders: identities, open tasks, pipeline
// position, live sequences and the derived next action. Messages/activities are no
// longer included here — they're part of the merged timeline at ./timeline, which
// paginates separately so a contact with years of history stays cheap to open.
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const scope = await leadScope(ctx);
  const lead = await getLeadDetail(ctx.orgId, id, scope.where);
  // Out of scope reads as "not found" rather than "forbidden" on purpose:
  // confirming a contact exists but belongs to a colleague is itself a leak.
  if (!lead) return fail("not found", 404);
  return ok(lead);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data = Object.fromEntries(Object.entries(body).filter(([k]) => PATCHABLE.has(k)));
  // Scope the update to this org so a foreign id can't be mutated.
  const res = await prisma.lead.updateMany({ where: { id, organizationId: ctx.orgId }, data });
  if (res.count === 0) return fail("not found", 404);
  if (Object.keys(data).some((k) => SCORE_SIGNALS.has(k))) {
    await recomputeAndSaveLeadScore(id, ctx.orgId);
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  return ok(lead);
}

// DELETE = GDPR erase
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const lead = await prisma.lead.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!lead) return fail("not found", 404);
  if (lead.email) {
    // Routed through suppress() (not a direct upsert) so the GDPR erasure itself lands
    // on the compliance ledger — the audit trail is meaningless if the one consent event
    // that matters most for a regulator skips it.
    await suppress(ctx.orgId, { email: lead.email, phone: lead.phone ?? undefined, linkedinUrl: lead.linkedinUrl ?? undefined }, "gdpr");
  }
  await prisma.lead.delete({ where: { id } });
  invalidate("leads:");
  invalidate("stats");
  return ok({ deleted: true });
}
