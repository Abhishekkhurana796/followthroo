import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { invalidate } from "@/lib/cache";
import { canAssignTo } from "@/lib/tasks";
import { leadScope } from "@/lib/scope";
import { notifyLeadAssigned } from "@/lib/notifications";

export const runtime = "nodejs";

// Bulk lead actions: add/remove tags, add to a static group/segment, assign an owner.
const Body = z.object({
  leadIds: z.array(z.string()).min(1),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  segmentId: z.string().optional(), // append these leads to a static segment
  /** userId to assign these contacts to; null unassigns (back to the team pool). */
  ownerId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");
  const { leadIds, addTags, removeTags, segmentId, ownerId } = parsed.data;

  // Only operate on leads this caller can actually see — org scope alone would
  // let a member retag or reassign a colleague's book by passing raw ids.
  const scope = await leadScope(ctx);
  const leads = await prisma.lead.findMany({
    where: { AND: [scope.where], id: { in: leadIds } },
    select: { id: true, tags: true },
  });
  if (leads.length === 0) return fail("None of those contacts are yours to change.", 403);

  if (ownerId !== undefined) {
    // Handing work to somebody follows the same rule as assigning them a task.
    if (ownerId !== null && !(await canAssignTo(ctx, ownerId))) {
      return fail("You cannot assign contacts to that member.", 403);
    }
    await prisma.lead.updateMany({
      where: { id: { in: leads.map((l) => l.id) }, organizationId: ctx.orgId },
      data: { ownerId },
    });
    invalidate("leads:");

    // One message for the batch, not one per contact. Unassigning (ownerId null)
    // tells nobody — there is no new owner to tell.
    if (ownerId) {
      const first = await prisma.lead.findUnique({
        where: { id: leads[0].id },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      const name = [first?.firstName, first?.lastName].filter(Boolean).join(" ") || first?.email || "A contact";
      await notifyLeadAssigned({
        organizationId: ctx.orgId,
        userId: ownerId,
        actorId: ctx.userId,
        leadId: leads[0].id,
        leadName: name,
        count: leads.length,
      }).catch((e) => console.error("[leads/bulk] assignment notification failed:", e));
    }
  }

  if (addTags?.length || removeTags?.length) {
    for (const lead of leads) {
      let tags = lead.tags;
      if (addTags?.length) tags = Array.from(new Set([...tags, ...addTags]));
      if (removeTags?.length) tags = tags.filter((t) => !removeTags.includes(t));
      await prisma.lead.update({ where: { id: lead.id }, data: { tags } });
    }
    invalidate("leads:");
  }

  if (segmentId) {
    const seg = await prisma.segment.findFirst({ where: { id: segmentId, organizationId: ctx.orgId } });
    if (!seg) return fail("segment not found", 404);
    const merged = Array.from(new Set([...seg.leadIds, ...leads.map((l) => l.id)]));
    await prisma.segment.update({ where: { id: seg.id }, data: { leadIds: merged } });
  }

  return ok({ updated: leads.length });
}
