import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepPosts } from "@/lib/posts/schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Posts sweep: publishes any due scheduled post a one-off job missed, starts
 * autopilots whose turn has come, and skips a review draft nobody approved
 * before its slot passed. Scheduler only (QStash, every 5 minutes) — unlike
 * the enrollment sweep there's no signed-in fallback, since this can write
 * to LinkedIn on someone's behalf and shouldn't be triggerable by a click.
 */
async function handle(req: NextRequest) {
  const rawBody = req.method === "POST" ? await req.clone().text() : "";
  if (!(await isAuthorizedCron(req, rawBody))) return fail("unauthorized", 401);
  return ok(await sweepPosts());
}

export async function GET(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "sweep failed", 500));
}
export async function POST(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "sweep failed", 500));
}
