import { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { getInboxThreads } from "@/lib/queries";
import { leadScope } from "@/lib/scope";

export const runtime = "nodejs";

// GET /api/inbox?status=unread|interested|not_interested|ooo
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const status = req.nextUrl.searchParams.get("status") || undefined;
  const scope = await leadScope(ctx);
  return ok(await getInboxThreads(ctx.orgId, status, scope.where));
}
