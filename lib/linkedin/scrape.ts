/**
 * Scrape jobs — queue, claim, results, import.
 *
 * The work runs on a machine we do not control: the rep's own browser, via the
 * extension, in their own logged-in LinkedIn session. That shapes everything
 * here. Jobs are claimed rather than pushed, a claim can be abandoned when
 * somebody closes their laptop, and nothing is trusted until it comes back.
 *
 * Contrast with PhantomBuster, where every automation takes a session cookie and
 * runs server-side: there is no credential in this model at all, because the
 * session belongs to the browser doing the work. See docs/linkedin-sourcing-ux.md.
 */
import { prisma } from "../db";
import { KIND_INFO, type ScrapeKind } from "./detect";

/** A job left "running" this long is assumed dead — browser closed, tab lost. */
const CLAIM_LEASE_MS = 20 * 60_000;

/** One scraped row, before it becomes a contact. Every field is optional: */
/** LinkedIn shows different columns on different surfaces. */
export interface ScrapedRow {
  profileUrl?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  location?: string;
  company?: string;
  title?: string;
  /** 1st / 2nd / 3rd — decides whether a DM is even possible (see phantombuster.md #9). */
  degree?: string;
  /** post_engagers only. */
  reaction?: string;
  comment?: string;
  /** activity_extract only. */
  postUrl?: string;
  postText?: string;
  [k: string]: unknown;
}

export type FailureKind = "selector_miss" | "empty" | "blocked" | "cancelled" | "error";

/**
 * Rows this rep has already pulled today, against their cap.
 *
 * Counts rows rather than jobs: one search returning 1,000 people is a much
 * bigger ask of LinkedIn than ten profile loads, and a per-job limit would
 * happily allow the former.
 */
export async function scrapeUsageToday(organizationId: string, userId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [account, agg] = await Promise.all([
    prisma.linkedInAccount.findFirst({
      where: { organizationId, userId },
      select: { dailyScrapeCap: true, status: true },
    }),
    prisma.linkedInScrapeJob.aggregate({
      where: { organizationId, userId, createdAt: { gte: since } },
      _sum: { resultCount: true },
    }),
  ]);

  const cap = account?.dailyScrapeCap ?? 500;
  const used = agg._sum.resultCount ?? 0;
  // Tomorrow, local — what the person actually wants to know is "when can I again".
  const resetsAt = new Date(since.getTime() + 86_400_000);
  return { cap, used, remaining: Math.max(0, cap - used), connected: account?.status === "connected", resetsAt };
}

export async function queueScrapeJob(input: {
  organizationId: string;
  userId: string;
  kind: ScrapeKind;
  inputUrl: string;
  inputQuery?: string | null;
  maxResults: number;
}) {
  const info = KIND_INFO[input.kind];
  return prisma.linkedInScrapeJob.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      inputUrl: input.inputUrl,
      inputQuery: input.inputQuery ?? null,
      // Clamp to the published ceiling rather than trusting the client. These
      // are LinkedIn's limits and the community-safe rates, not preferences.
      maxResults: Math.max(1, Math.min(input.maxResults, info.maxResults)),
    },
  });
}

/**
 * Hand the extension its next job.
 *
 * One at a time per rep, deliberately: two tabs scraping at once is both a
 * pacing problem and a confusing thing to watch. An abandoned claim is released
 * after the lease rather than blocking the queue forever.
 */
export async function claimScrapeJob(organizationId: string, userId: string) {
  const stale = new Date(Date.now() - CLAIM_LEASE_MS);
  await prisma.linkedInScrapeJob.updateMany({
    where: { organizationId, userId, status: "running", startedAt: { lt: stale } },
    data: { status: "queued", startedAt: null },
  });

  const running = await prisma.linkedInScrapeJob.findFirst({
    where: { organizationId, userId, status: "running" },
    select: { id: true },
  });
  if (running) return null;

  const next = await prisma.linkedInScrapeJob.findFirst({
    where: { organizationId, userId, status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return null;

  // Guarded update: two tabs polling at once must not both win the same job.
  const claimed = await prisma.linkedInScrapeJob.updateMany({
    where: { id: next.id, status: "queued" },
    data: { status: "running", startedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  const { remaining } = await scrapeUsageToday(organizationId, userId);
  return {
    id: next.id,
    kind: next.kind,
    url: next.inputUrl,
    // Never ask for more than the rep has left today, even if the job wanted more.
    maxResults: Math.min(next.maxResults, Math.max(0, remaining)),
  };
}

/** Progress ping while a long scrape runs, so the UI is not a spinner. */
export async function reportProgress(organizationId: string, jobId: string, progress: number) {
  await prisma.linkedInScrapeJob.updateMany({
    where: { id: jobId, organizationId, status: "running" },
    data: { progress: Math.max(0, progress) },
  });
}

/**
 * Finish a job.
 *
 * Zero rows is not automatically a failure, and the difference matters: an empty
 * search is a fact about the search, a selector miss is a bug in us. Reporting
 * both as "0 results" would make every breakage look like a quiet, correct
 * answer — which is how a scraper rots without anyone noticing.
 */
export async function completeScrapeJob(input: {
  organizationId: string;
  jobId: string;
  rows?: ScrapedRow[];
  failureKind?: FailureKind;
  error?: string;
}) {
  const rows = input.rows ?? [];

  // Dedupe within the batch on profile URL — LinkedIn repeats people across
  // pages of the same search, and importing them twice is not the reviewer's
  // problem to spot.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = (r.profileUrl ?? "").toLowerCase().replace(/\/+$/, "");
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const failed = !!input.failureKind && input.failureKind !== "empty";

  await prisma.linkedInScrapeJob.updateMany({
    where: { id: input.jobId, organizationId: input.organizationId },
    data: {
      status: failed ? "failed" : "done",
      results: unique as unknown as object[],
      resultCount: unique.length,
      progress: unique.length,
      failureKind: input.failureKind ?? null,
      error: input.error?.slice(0, 500) ?? null,
      finishedAt: new Date(),
    },
  });
  return { stored: unique.length, deduped: rows.length - unique.length };
}

/** Human-readable, and honest about which kind of nothing happened. */
export function describeOutcome(job: {
  status: string;
  resultCount: number;
  failureKind: string | null;
}): string {
  if (job.status === "queued") return "Waiting for your browser";
  if (job.status === "running") return "Reading LinkedIn…";
  if (job.status === "cancelled") return "Cancelled";
  if (job.failureKind === "selector_miss") {
    return "We could not read that page — LinkedIn has changed its layout. This is on us.";
  }
  if (job.failureKind === "blocked") {
    return "LinkedIn stopped the request. Give it a few hours before trying again.";
  }
  if (job.status === "failed") return "Something went wrong reading that page.";
  if (job.resultCount === 0) return "That page had nothing on it.";
  return `${job.resultCount} found`;
}

/**
 * Turn reviewed rows into contacts.
 *
 * Goes through `ingestMany` like every other source, rather than writing leads
 * directly — that is what gets it the identity graph (so a scraped profile
 * merges with the contact you already emailed rather than becoming a twin), the
 * pipeline entry, and an owner from the source's assignment rule.
 *
 * `rowIndexes` is what the reviewer ticked. Importing everything is a choice
 * they make, not the default: a mistyped search URL should not silently add two
 * thousand of the wrong people.
 */
export async function importScrapedRows(input: {
  organizationId: string;
  jobId: string;
  rowIndexes?: number[];
}) {
  const { ingestMany } = await import("../ingest");

  const job = await prisma.linkedInScrapeJob.findFirst({
    where: { id: input.jobId, organizationId: input.organizationId },
  });
  if (!job) throw new Error("Job not found");

  const all = (job.results as unknown as ScrapedRow[]) ?? [];
  const rows = input.rowIndexes?.length ? input.rowIndexes.map((i) => all[i]).filter(Boolean) : all;
  if (rows.length === 0) return { received: 0, created: 0, merged: 0, duplicates: 0, suppressed: 0 };

  // Which source this counts as, so ROI and the assignment rule can differ by
  // where the contact actually came from.
  const sourceKey =
    job.kind === "post_engagers" || job.kind === "activity_extract"
      ? "linkedin_engagement"
      : job.kind === "profile_scrape"
        ? "linkedin_profile"
        : "linkedin_search";

  const events = rows
    .filter((r) => r.profileUrl)
    .map((r) => {
      const [first, ...rest] = (r.fullName ?? "").trim().split(/\s+/);
      return {
        identities: [{ kind: "linkedin" as const, value: r.profileUrl! }],
        channel: "linkedin" as const,
        direction: "inbound" as const,
        sourceKey,
        profile: {
          firstName: r.firstName ?? first ?? null,
          lastName: r.lastName ?? (rest.length ? rest.join(" ") : null),
          company: r.company ?? null,
          title: r.title ?? r.headline ?? null,
        },
        meta: {
          headline: r.headline,
          location: r.location,
          degree: r.degree,
          scrapedFrom: job.inputUrl,
          ...(r.reaction ? { reaction: r.reaction } : {}),
          ...(r.comment ? { comment: r.comment } : {}),
        },
      };
    });

  const result = await ingestMany(input.organizationId, events);

  await prisma.linkedInScrapeJob.updateMany({
    where: { id: job.id, organizationId: input.organizationId },
    data: { importedAt: new Date(), importedCount: result.created + result.duplicates },
  });
  return result;
}

/**
 * Which rows are already contacts, so the review table can say so up front.
 *
 * The identity graph would merge them anyway, but silently: somebody reviewing
 * 200 rows deserves to see "40 of these you already have" before they click, not
 * to discover it in the import summary afterwards.
 */
export async function flagKnownRows(organizationId: string, rows: ScrapedRow[]): Promise<boolean[]> {
  const urls = rows.map((r) => (r.profileUrl ?? "").toLowerCase().replace(/\/+$/, "")).filter(Boolean);
  if (urls.length === 0) return rows.map(() => false);

  const { normalize } = await import("../identity");
  const normalised = urls.map((u) => normalize("linkedin", u)).filter((v): v is string => !!v);

  const known = await prisma.contactIdentity.findMany({
    where: { organizationId, kind: "linkedin", value: { in: normalised } },
    select: { value: true },
  });
  const set = new Set(known.map((k) => k.value));
  return rows.map((r) => {
    const v = normalize("linkedin", (r.profileUrl ?? "").toLowerCase().replace(/\/+$/, ""));
    return !!v && set.has(v);
  });
}
