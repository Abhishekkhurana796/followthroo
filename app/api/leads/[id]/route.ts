import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, type TenantContext } from "@/lib/tenant";
import { invalidate } from "@/lib/cache";
import { recomputeAndSaveLeadScore } from "@/lib/scoring";
import { getLeadDetail } from "@/lib/queries";
import { leadScope, unassignedScope } from "@/lib/scope";
import { suppress } from "@/lib/crm";
import { canAssignTo } from "@/lib/tasks";
import { notifyLeadAssigned } from "@/lib/notifications";
import { requireFeature } from "@/lib/billing/limits";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Fields the client is allowed to PATCH (never id / organizationId / relations).
const PATCHABLE = new Set([
  "firstName", "lastName", "email", "phone", "linkedinUrl", "company", "title", "stage", "tags", "custom", "optedOut", "consent",
  // Scoring v1 qualifying signals (product PRD §6) — manually set for now.
  "budgetMentioned", "timelineMentioned", "decisionMakerConfirmed",
]);
const SCORE_SIGNALS = new Set(["budgetMentioned", "timelineMentioned", "decisionMakerConfirmed"]);

/**
 * The contacts this caller may open, change or erase: their own scope, plus the
 * unassigned pool for the roles that manage it (lib/scope.ts).
 *
 * PATCH and DELETE used to check only organizationId while GET checked the scope,
 * so a team member who could not open a colleague's contact could still edit it —
 * or GDPR-erase it — by sending its id. One rule now covers all three, and
 * anything outside it reads as "not found" rather than "forbidden".
 */
async function visibleLeads(ctx: TenantContext): Promise<Prisma.LeadWhereInput> {
  const { where } = await leadScope(ctx);
  const unassigned = unassignedScope(ctx);
  return unassigned ? { OR: [where, unassigned] } : where;
}

// The full contact record the lead page renders: identities, open tasks, pipeline
// position, live sequences and the derived next action. Messages/activities are no
// longer included here — they're part of the merged timeline at ./timeline, which
// paginates separately so a contact with years of history stays cheap to open.
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const lead = await getLeadDetail(ctx.orgId, id, await visibleLeads(ctx));
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
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([k]) => PATCHABLE.has(k)));
  // Scoped to what this caller can see, so neither a foreign id nor a
  // colleague's contact can be mutated.
  const visible = await visibleLeads(ctx);

  // Assigning is not a plain field: it has a permission rule — the same one
  // tasks and bulk assign use — and the new owner has to be told. Before this
  // the only way to hand one contact to someone was to tick it on the Leads
  // screen and use the bulk bar, which nobody found.
  const reassigning = "ownerId" in body;
  let before: { ownerId: string | null; firstName: string | null; lastName: string | null; email: string | null } | null = null;
  if (reassigning) {
    if (body.ownerId !== null && typeof body.ownerId !== "string") {
      return fail("ownerId must be a member's user id, or null to unassign.", 422);
    }
    const ownerId = (body.ownerId as string | null) || null;
    if (ownerId && !(await canAssignTo(ctx, ownerId))) {
      return fail("You cannot assign a contact to that member.", 403);
    }
    // Handing a contact to somebody else is Grow and up; on Start you own your own.
    if (ownerId && ownerId !== ctx.userId) {
      const locked = await requireFeature(ctx.orgId, "lead_assignment", "Assigning contacts to teammates");
      if (locked) return locked;
    }
    before = await prisma.lead.findFirst({
      where: { AND: [visible, { id }] },
      select: { ownerId: true, firstName: true, lastName: true, email: true },
    });
    if (!before) return fail("not found", 404);
    data.ownerId = ownerId;
  }

  const res = await prisma.lead.updateMany({ where: { AND: [visible, { id }] }, data });
  if (res.count === 0) return fail("not found", 404);
  if (Object.keys(data).some((k) => SCORE_SIGNALS.has(k))) {
    await recomputeAndSaveLeadScore(id, ctx.orgId);
  }

  if (reassigning) {
    invalidate("leads:");
    const ownerId = data.ownerId as string | null;
    if (ownerId && before && before.ownerId !== ownerId) {
      const leadName = [before.firstName, before.lastName].filter(Boolean).join(" ") || before.email || "A contact";
      await notifyLeadAssigned({ organizationId: ctx.orgId, userId: ownerId, actorId: ctx.userId, leadId: id, leadName }).catch(
        (e) => console.error("[leads] assignment notification failed:", e),
      );
    }
  }

  const lead = await prisma.lead.findUnique({ where: { id } });
  return ok(lead);
}

// DELETE = GDPR erase
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const lead = await prisma.lead.findFirst({ where: { AND: [await visibleLeads(ctx), { id }] } });
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
