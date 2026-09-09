import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";
import { listSources } from "@/lib/lead-sources";
import { ASSIGNMENT_RULES } from "@/lib/assignment";
import { canAssignTo } from "@/lib/tasks";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  return ok(await listSources(ctx.orgId));
}

const Patch = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(60).optional(),
  monthlyCost: z.number().min(0).max(10_000_000).nullable().optional(),
  active: z.boolean().optional(),
  // Auto-assignment for contacts arriving from this source (lib/assignment.ts).
  assignmentRule: z.enum(ASSIGNMENT_RULES).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  assignmentDept: z.enum(["marketing", "sales", "support", "collections", "recruitment"]).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  // Editing source cost/labels is a department-configuration action, same tier as
  // creating a pipeline.
  const gate = requireRole(ctx, ["owner", "admin", "group_leader"]);
  if (gate) return gate;

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("id is required.", 422);
  const { id, ...data } = parsed.data;

  const existing = await prisma.leadSource.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!existing) return fail("Source not found.", 404);

  // Pointing a source at a person is handing them work, so it follows the same
  // rule as assigning them a task rather than being a free-text id.
  if (data.assignedToId && !(await canAssignTo(ctx, data.assignedToId))) {
    return fail("You cannot route contacts to that member.", 403);
  }
  if (data.assignmentRule === "fixed" && !(data.assignedToId ?? existing.assignedToId)) {
    return fail("Choose who this source's contacts should go to.", 422);
  }

  const updated = await prisma.leadSource.update({ where: { id }, data });
  return ok({ ...updated, monthlyCost: updated.monthlyCost ? Number(updated.monthlyCost) : null });
}
