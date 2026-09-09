import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { readPrefs } from "@/lib/task-reminders";

export const runtime = "nodejs";

/**
 * Notification preferences.
 *
 * These used to live in localStorage, which meant the toggles were decorative.
 * Now that reminders actually send email, an off switch the server can read is
 * not optional.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { notificationPrefs: true },
  });
  return ok(readPrefs(user?.notificationPrefs));
}

const Body = z.object({
  taskReminders: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
  taskAssigned: z.boolean().optional(),
  leadAssigned: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Expected { taskReminders?, dailyDigest?, taskAssigned?, leadAssigned? }", 422);

  const current = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { notificationPrefs: true },
  });
  const next = { ...readPrefs(current?.notificationPrefs), ...parsed.data };

  await prisma.user.update({ where: { id: ctx.userId }, data: { notificationPrefs: next } });
  return ok(next);
}
