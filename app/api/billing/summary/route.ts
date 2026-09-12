import { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing/summary";

export const runtime = "nodejs";

/**
 * GET /api/billing/summary — the workspace's plan, today's credits and what they
 * went on, and its usage of each limit. Read by Billing and the sidebar's credit
 * chip. Every member can see it; changing the plan is for owners and admins.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  return ok(await billingSummary(ctx.orgId));
}
