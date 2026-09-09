import type { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { assignableMembers } from "@/lib/tasks";

export const runtime = "nodejs";

/**
 * GET /api/tasks/assignees
 *
 * Who the caller may hand a task to, already filtered by the same rule the API
 * enforces on write. The dialog uses the length of this list to decide whether
 * to show a picker at all: one entry means there is no choice to offer, and a
 * select box with a single option is just furniture.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const members = await assignableMembers(ctx);

  return ok({
    self: ctx.userId,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user?.name || m.user?.email || "Unknown",
      email: m.user?.email ?? null,
      department: m.department,
      isSelf: m.userId === ctx.userId,
    })),
  });
}
