import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { claimScrapeJob, completeScrapeJob, reportProgress, scrapeUsageToday } from "@/lib/linkedin/scrape";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * The extension's end of the queue.
 *
 * Authenticated by the per-member `extToken`, not a session — this is called
 * from a background service worker with no cookies. The org and user come from
 * the token, never from the request body, so one rep's extension cannot claim
 * another's work by guessing an id.
 */
export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const usage = await scrapeUsageToday(account.organizationId, account.userId);
  if (usage.remaining <= 0) {
    // Not an error — the extension should go quiet until tomorrow rather than
    // retrying every 45 seconds against a limit that will not move.
    return withCors(ok({ job: null, pausedUntil: usage.resetsAt, reason: "daily_cap" }));
  }

  const job = await claimScrapeJob(account.organizationId, account.userId);
  return withCors(ok({ job, remaining: usage.remaining }));
}

const Row = z
  .object({
    profileUrl: z.string().max(500).optional(),
    fullName: z.string().max(200).optional(),
    firstName: z.string().max(120).optional(),
    lastName: z.string().max(120).optional(),
    headline: z.string().max(500).optional(),
    location: z.string().max(200).optional(),
    company: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    degree: z.string().max(20).optional(),
    reaction: z.string().max(40).optional(),
    comment: z.string().max(2000).optional(),
    postUrl: z.string().max(500).optional(),
    postText: z.string().max(4000).optional(),
  })
  // Rows come from a browser we do not control, so everything is bounded and
  // anything unexpected is dropped rather than stored.
  .strip();

const Report = z.object({
  jobId: z.string().min(1),
  /** Mid-run heartbeat: how many rows seen so far. */
  progress: z.number().int().nonnegative().optional(),
  /** Present only on the final call. */
  rows: z.array(Row).max(5000).optional(),
  done: z.boolean().optional(),
  /**
   * Why it produced nothing. `selector_miss` and `empty` both mean zero rows and
   * must not be conflated — one is our bug, one is a fact about the page.
   */
  failureKind: z.enum(["selector_miss", "empty", "blocked", "error"]).optional(),
  error: z.string().max(500).optional(),
});

/** POST — progress heartbeat, or the final result. */
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Report.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail(parsed.error.issues[0]?.message ?? "invalid body"));
  const { jobId, progress, rows, done, failureKind, error } = parsed.data;

  if (!done && progress !== undefined) {
    await reportProgress(account.organizationId, jobId, progress);
    return withCors(ok({ acknowledged: true }));
  }

  const result = await completeScrapeJob({
    organizationId: account.organizationId,
    jobId,
    rows,
    failureKind,
    error,
  });
  return withCors(ok(result));
}
