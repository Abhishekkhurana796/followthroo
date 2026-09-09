import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepTaskReminders } from "@/lib/task-reminders";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Task reminder + escalation sweep.
 *  - QStash schedule (signed) / CRON_SECRET -> every org, every 15 minutes.
 *  - Authenticated user -> the same sweep, which is idempotent, so a manual hit
 *    is a safe way to test delivery without waiting a quarter of an hour.
 *
 * The sweep is global rather than per-org: `Task.remindedAt` and
 * `Task.escalatedAt` decide what is owed, and both are guarded, so there is
 * nothing to scope and nothing to double-send.
 */
async function handle(req: NextRequest) {
  const rawBody = req.method === "POST" ? await req.clone().text() : "";
  if (await isAuthorizedCron(req, rawBody)) return ok(await sweepTaskReminders());

  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  return ok(await sweepTaskReminders());
}

export async function GET(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "sweep failed", 500));
}
export async function POST(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "sweep failed", 500));
}
