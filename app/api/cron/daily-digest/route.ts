import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepDailyDigests, buildDigest } from "@/lib/task-reminders";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The morning digest.
 *
 * Runs HOURLY, not daily: it sends to the orgs whose own local clock has just
 * reached 8am. Firing once a day on server time would mean 8am UTC, which is
 * half past one in the afternoon for an Indian team.
 *
 * An authenticated user gets a preview of their own digest instead of a sweep,
 * which is how you check the thing without waiting for tomorrow.
 */
async function handle(req: NextRequest) {
  const rawBody = req.method === "POST" ? await req.clone().text() : "";
  if (await isAuthorizedCron(req, rawBody)) return ok(await sweepDailyDigests());

  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const preview = await buildDigest(ctx.orgId, ctx.userId);
  return ok({ preview: preview ?? null, note: preview ? undefined : "Nothing due — no digest would send." });
}

export async function GET(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "digest failed", 500));
}
export async function POST(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "digest failed", 500));
}
