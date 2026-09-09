import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { getLeadTimeline } from "@/lib/queries";
import { leadScope } from "@/lib/scope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/leads/:id/timeline?limit= — the merged, channel-agnostic history.
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  // Confirm ownership before reading five tables keyed off this lead id.
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!lead) return fail("not found", 404);

  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 100), 1), 300);
  const scope = await leadScope(ctx);
  return ok(await getLeadTimeline(ctx.orgId, id, limit, scope.where));
}
