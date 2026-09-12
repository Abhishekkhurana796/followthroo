import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import {
  scrapeUsageToday,
  describeOutcome,
  flagKnownRows,
  importScrapedRows,
  type ScrapedRow,
} from "@/lib/linkedin/scrape";

export const runtime = "nodejs";

/**
 * The dashboard side of LinkedIn sourcing: the jobs list and the review step.
 * The extension talks to ./claim and ./collect instead, with its own bearer
 * token — and that is now the only place jobs are created.
 *
 * There used to be a POST here that queued a job from a URL pasted into the app
 * ("Find leads"). That input was removed on 2026-09-10 at the client's request:
 * people bring contacts in from LinkedIn itself with the extension, or in bulk by
 * CSV. A route with no caller is a route nobody is watching, so it went too. See
 * docs/linkedin-sourcing-ux.md.
 *
 * Jobs are always scoped to the caller: a scrape runs in *their* LinkedIn
 * session, so the results are theirs. There is no "see the team's scrapes" view
 * — that would be reading somebody else's network.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const job = await prisma.linkedInScrapeJob.findFirst({
      where: { id, organizationId: ctx.orgId, userId: ctx.userId },
    });
    if (!job) return fail("Job not found", 404);
    const rows = (job.results as unknown as ScrapedRow[]) ?? [];
    return ok({
      ...job,
      results: rows,
      // Say up front which of these they already have, rather than letting the
      // identity graph merge them silently after the click.
      known: await flagKnownRows(ctx.orgId, rows),
      outcome: describeOutcome(job),
    });
  }

  const [jobs, usage] = await Promise.all([
    prisma.linkedInScrapeJob.findMany({
      where: { organizationId: ctx.orgId, userId: ctx.userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      // Deliberately omits `results` — a list of 25 jobs each holding 1,000 rows
      // is megabytes of payload for a screen that shows counts.
      select: {
        id: true, kind: true, inputUrl: true, status: true, progress: true,
        resultCount: true, importedAt: true, importedCount: true,
        failureKind: true, createdAt: true, finishedAt: true,
      },
    }),
    scrapeUsageToday(ctx.orgId, ctx.userId),
  ]);

  return ok({
    jobs: jobs.map((j) => ({ ...j, outcome: describeOutcome(j) })),
    usage,
  });
}

const Action = z.object({
  id: z.string().min(1),
  action: z.enum(["import", "cancel"]),
  /** import: which rows the reviewer ticked. Omitted means all of them. */
  rowIndexes: z.array(z.number().int().nonnegative()).max(5000).optional(),
});

/** PATCH /api/linkedin/scrape — import reviewed rows, or cancel a job. */
export async function PATCH(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request.", 422);

  const job = await prisma.linkedInScrapeJob.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId, userId: ctx.userId },
    select: { id: true, status: true },
  });
  if (!job) return fail("Job not found", 404);

  if (parsed.data.action === "cancel") {
    await prisma.linkedInScrapeJob.updateMany({
      where: { id: job.id, status: { in: ["queued", "running"] } },
      data: { status: "cancelled", failureKind: "cancelled", finishedAt: new Date() },
    });
    return ok({ cancelled: true });
  }

  const result = await importScrapedRows({
    organizationId: ctx.orgId,
    jobId: job.id,
    rowIndexes: parsed.data.rowIndexes,
    actorId: ctx.userId,
    createdKind: "linkedin_bulk",
  });
  if (result.refused) return fail(result.refused, 402);
  return ok(result);
}
