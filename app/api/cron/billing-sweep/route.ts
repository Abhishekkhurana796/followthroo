import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepBilling } from "@/lib/billing/sweep";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Billing sweep: credits still held by LinkedIn invitations that will never
 * report back, and trial / Test Drive reminders. See lib/billing/sweep.ts.
 *
 * Scheduler only. Unlike the enrollment sweep there is no signed-in variant: it
 * emails workspace admins, and that shouldn't be something a click can set off.
 */
async function handle(req: NextRequest) {
  const rawBody = req.method === "POST" ? await req.clone().text() : "";
  if (!(await isAuthorizedCron(req, rawBody))) return fail("unauthorized", 401);
  return ok(await sweepBilling());
}

export async function GET(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "sweep failed", 500));
}
export async function POST(req: NextRequest) {
  return handle(req).catch((e) => fail(e instanceof Error ? e.message : "sweep failed", 500));
}
