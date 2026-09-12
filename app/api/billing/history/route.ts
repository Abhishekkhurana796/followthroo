import { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { creditHistory } from "@/lib/billing/summary";

export const runtime = "nodejs";

/**
 * GET /api/billing/history?before=<iso> — every charge, refund, daily grant and
 * top-up, newest first, a page at a time. Pass the response's `next` as `before`.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const raw = req.nextUrl.searchParams.get("before");
  const before = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : undefined;
  return ok(await creditHistory(ctx.orgId, { before }));
}
