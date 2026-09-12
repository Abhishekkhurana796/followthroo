import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { scheduleAutopilot } from "@/lib/posts/schedule";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const autopilot = await prisma.autopilot.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!autopilot) return fail("not found", 404);
  const runs = await prisma.autopilotRun.findMany({ where: { autopilotId: id }, orderBy: { createdAt: "desc" }, take: 20 });
  return ok({ ...autopilot, runs });
}

const Patch = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  brief: z.string().max(2000).nullable().optional(),
});

/** PATCH — only enable/disable, rename, or edit the brief. Changing schedule/query/model means recreating it (kept simple deliberately). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  const existing = await prisma.autopilot.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!existing) return fail("not found", 404);

  const data: Record<string, unknown> = { ...parsed.data };
  // Turning it back on picks up wherever its schedule says next, not "immediately".
  if (parsed.data.enabled === true && !existing.enabled) {
    data.nextRunAt = scheduleAutopilot(existing);
  }
  const updated = await prisma.autopilot.update({ where: { id }, data });
  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const existing = await prisma.autopilot.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!existing) return fail("not found", 404);
  await prisma.autopilotRun.deleteMany({ where: { autopilotId: id } });
  await prisma.autopilot.delete({ where: { id } });
  return ok({ deleted: true });
}
