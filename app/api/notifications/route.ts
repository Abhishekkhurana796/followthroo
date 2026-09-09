import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { listNotifications, markRead } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * GET /api/notifications — the bell's payload for the signed-in user.
 *
 * Always scoped to the caller. There is no "see someone else's notifications"
 * mode, not even for an owner: a notification is addressed to a person, and an
 * owner wanting to know what their team is working on has the team performance
 * table for that.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  return ok(await listNotifications(ctx.orgId, ctx.userId));
}

const Patch = z.object({
  /** Specific ids, or omit to mark everything read. */
  ids: z.array(z.string().min(1)).max(200).optional(),
});

/** PATCH /api/notifications — mark read. */
export async function PATCH(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Patch.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return fail("Invalid body.", 422);
  return ok({ marked: await markRead(ctx.orgId, ctx.userId, parsed.data.ids) });
}
