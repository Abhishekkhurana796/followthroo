import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { getHome } from "@/lib/queries";
import { leadScope, resolveViewAs, unassignedScope } from "@/lib/scope";

export const runtime = "nodejs";

// GET /api/home?member=<userId> — the action-first dashboard payload: what needs
// attention now, what's due, what arrived today. Analytics stay on /api/reports;
// this is a work queue, not a scoreboard.
//
// Scoped: a team member sees their own book, a manager their department, an
// owner everything — and `?member=` drills into one person through the same
// path, so there is one dashboard rather than two.
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const viewAs = await resolveViewAs(ctx, req.nextUrl.searchParams.get("member"));
  if (viewAs === null) return fail("You cannot view that member's dashboard.", 403);

  return ok(await getHome(ctx.orgId, await leadScope(ctx, viewAs), unassignedScope(ctx)));
}
