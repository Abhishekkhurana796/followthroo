import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { getTeamPerformance } from "@/lib/reports";
import { seesEverything } from "@/lib/roles";
import { assignableMembers } from "@/lib/tasks";

export const runtime = "nodejs";

/**
 * GET /api/team/performance?days=30
 *
 * The owner's "how is the team doing" table. Who appears in it follows the same
 * rule as who you can assign work to (lib/tasks.ts assignableMembers): owners
 * and admins see everyone, a manager sees their department, and a plain member
 * sees only themselves — which makes this endpoint safe to call from any
 * dashboard without branching on role at the call site.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 7), 90);

  const userIds = seesEverything(ctx.role) ? null : (await assignableMembers(ctx)).map((m) => m.userId);
  if (userIds && userIds.length === 0) return fail("No members visible to you.", 403);

  const rows = await getTeamPerformance(ctx.orgId, days, userIds);
  return ok({
    days,
    // The client uses this to decide whether to offer the "View: All team"
    // switcher at all — a team of one does not need one.
    canDrillDown: rows.length > 1,
    rows,
  });
}
