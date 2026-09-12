import { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { getOrCreateAccount } from "@/lib/linkedin/auth";
import { peekActions } from "@/lib/linkedin/queue";

export const runtime = "nodejs";

/**
 * The LinkedIn screen's "Queued invitations": who goes out next, who is waiting
 * and why, and today's note allowance.
 *
 * The same `peekActions` the desktop app reads before a run, so the list someone
 * edits here is the list that goes out. The whole queue rather than today's
 * share of it — somebody deciding notes for next week's invitations needs to
 * see them today. Read-only; deciding a note is PATCH /api/linkedin/invitations/:id.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const account = await getOrCreateAccount(ctx.orgId, ctx.userId);
  const peek = await peekActions(account, 50, { wholeQueue: true });
  return ok({ ...peek, accountType: account.accountType });
}
