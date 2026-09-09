import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { detectScrapeKind } from "@/lib/linkedin/detect";
import { completeScrapeJob, importScrapedRows, queueScrapeJob, scrapeUsageToday } from "@/lib/linkedin/scrape";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Trim to fit instead of refusing.
 *
 * These were `.max(n)`, and a single verbose LinkedIn headline — the kind that
 * reads "Deputy Manager | Influencer Marketing | Brand Management at Acme.
 * Ex-Ogilvy | Ex-FCB" — failed the whole request with "String must contain at
 * most 200 character(s)". Ten people the person had deliberately ticked, lost to
 * one long job title.
 *
 * A length ceiling here is a storage concern, not a correctness one. Losing the
 * import is a far worse outcome than losing the tail of a headline, so the
 * ceiling truncates. The extension clamps at source too (content.js rowData);
 * this is the backstop for older extension builds, which is exactly the case
 * that produced the bug report.
 */
const capped = (n: number) => z.string().transform((s) => s.slice(0, n));

const Row = z
  .object({
    profileUrl: capped(500),
    fullName: capped(200).optional(),
    firstName: capped(120).optional(),
    lastName: capped(120).optional(),
    headline: capped(500).optional(),
    location: capped(200).optional(),
    company: capped(200).optional(),
    title: capped(200).optional(),
    degree: capped(20).optional(),
  })
  .strip();

const Body = z.object({
  /** The LinkedIn page they were on, so the contact records where it came from. */
  sourceUrl: z.string().max(1000),
  /** The rows they ticked. Absent when queueing the whole result set instead. */
  rows: z.array(Row).max(100).optional(),
  /**
   * "Add all results", not just this page.
   *
   * A LinkedIn search page shows about ten people, so a bar that can only take
   * what is on screen is a nice touch rather than a prospecting tool. This
   * queues the same background job the app queues, which paginates properly.
   */
  allPages: z.boolean().optional(),
  /** How many the page claims exist, so we can size the job sensibly. */
  estimated: z.number().int().positive().max(5000).optional(),
});

/**
 * POST /api/linkedin/scrape/collect
 *
 * The in-page bar's endpoint: someone ticked specific people on a LinkedIn page
 * and pressed Add. Distinct from the queue in ../claim, which exists for bulk
 * reads the app asked for.
 *
 * It imports immediately rather than staging for review, and that is the right
 * call here: the review step exists because a pasted search URL might return two
 * thousand strangers. Here they looked at each person and ticked a box — asking
 * them to confirm again would be asking twice.
 */
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail(parsed.error.issues[0]?.message ?? "invalid body"));
  const { sourceUrl, rows, allPages, estimated } = parsed.data;
  if (!allPages && !rows?.length) return withCors(fail("Nothing selected.", 422));

  const { organizationId, userId } = account;

  // Same daily ceiling as a bulk read. Hand-picking is gentler on LinkedIn, but
  // a cap that one path can sidestep is not a cap.
  const usage = await scrapeUsageToday(organizationId, userId);
  if (usage.remaining <= 0) {
    return withCors(
      fail(`Daily limit reached (${usage.used} of ${usage.cap}). Resets at midnight.`, 429),
    );
  }

  const detected = detectScrapeKind(sourceUrl);

  // "All results" is just the ordinary bulk job, queued from the page instead of
  // from the app. The extension's own poller picks it up and paginates — no
  // second code path, and it obeys the same cap and pacing.
  if (allPages) {
    if (!detected) return withCors(fail("We cannot read that page in bulk.", 422));
    const job = await queueScrapeJob({
      organizationId,
      userId,
      kind: detected.kind,
      inputUrl: detected.url,
      maxResults: Math.min(estimated ?? detected.info.defaultResults, usage.remaining),
    });
    return withCors(ok({ jobId: job.id, queued: true, maxResults: job.maxResults }));
  }

  const accepted = (rows ?? []).slice(0, usage.remaining);

  // Recorded as a job like any other, so it shows in Activity, counts toward the
  // cap, and carries the same provenance rather than appearing from nowhere.
  const job = await queueScrapeJob({
    organizationId,
    userId,
    kind: detected?.kind ?? "search_export",
    inputUrl: detected?.url ?? sourceUrl,
    maxResults: accepted.length,
  });

  await completeScrapeJob({ organizationId, jobId: job.id, rows: accepted });
  const result = await importScrapedRows({ organizationId, jobId: job.id });

  return withCors(
    ok({
      jobId: job.id,
      received: accepted.length,
      created: result.created,
      duplicates: result.duplicates,
      skipped: (rows?.length ?? 0) - accepted.length,
    }),
  );
}
