import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { detectScrapeKind, SUPPORTED_HINT } from "@/lib/linkedin/detect";
import {
  queueScrapeJob,
  scrapeUsageToday,
  describeOutcome,
  flagKnownRows,
  importScrapedRows,
  type ScrapedRow,
} from "@/lib/linkedin/scrape";

export const runtime = "nodejs";

/**
 * The dashboard side of LinkedIn sourcing. The extension talks to
 * ./claim and ./results instead, with its own bearer token.
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

const Create = z.object({
  url: z.string().trim().min(1),
  maxResults: z.number().int().positive().max(5000).optional(),
});

/** POST /api/linkedin/scrape — queue a job from a pasted URL. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Paste a LinkedIn URL.", 422);

  // The URL decides the scraper. Nobody picks one — see docs/linkedin-sourcing-ux.md.
  const detected = detectScrapeKind(parsed.data.url);
  if (!detected) return fail(`That is not a LinkedIn page we can read. ${SUPPORTED_HINT}`, 422);

  const usage = await scrapeUsageToday(ctx.orgId, ctx.userId);
  if (!usage.connected) {
    return fail("Connect the Followthroo extension first — it reads LinkedIn from your own browser.", 409);
  }
  if (usage.remaining <= 0) {
    return fail(
      `You have pulled ${usage.used} of ${usage.cap} rows today. This resets at midnight.`,
      429,
    );
  }

  const job = await queueScrapeJob({
    organizationId: ctx.orgId,
    userId: ctx.userId,
    kind: detected.kind,
    inputUrl: detected.url,
    maxResults: parsed.data.maxResults ?? detected.info.defaultResults,
  });

  return ok({ id: job.id, kind: job.kind, maxResults: job.maxResults }, { status: 201 });
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
  });
  return ok(result);
}
