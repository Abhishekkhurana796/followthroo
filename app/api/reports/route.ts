import { NextRequest } from "next/server";
import type { Department } from "@prisma/client";
import { ok } from "@/lib/http";
import { requireOrg, isDepartmentScoped } from "@/lib/tenant";
import { getReport, getPipelineFunnels, getSourceRoi, getResponseLeaderboard, getLinkedInReport } from "@/lib/reports";

export const runtime = "nodejs";

// GET /api/reports?days=30
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 7), 90);
  const department = (isDepartmentScoped(ctx) ? ctx.department : undefined) as Department | undefined;

  const [report, pipelineFunnels, sourceRoi, responseLeaderboard, linkedin] = await Promise.all([
    getReport(ctx.orgId, days),
    getPipelineFunnels(ctx.orgId, department),
    getSourceRoi(ctx.orgId),
    getResponseLeaderboard(ctx.orgId, days),
    getLinkedInReport(ctx.orgId, days),
  ]);

  return ok({ ...report, pipelineFunnels, sourceRoi, responseLeaderboard, linkedin });
}
