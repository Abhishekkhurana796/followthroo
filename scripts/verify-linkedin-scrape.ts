/**
 * Verification for LinkedIn sourcing (Phase C).
 *
 * The work runs on a machine we do not control — the rep's own browser — so most
 * of what matters here is what happens when that machine misbehaves: two tabs
 * racing for one job, a laptop closing mid-scrape, a cap being ignored, or one
 * rep's extension reaching for another's work.
 *
 *   npx tsx --env-file=.env.local scripts/verify-linkedin-scrape.ts
 */
import { prisma } from "../lib/db";
import { detectScrapeKind } from "../lib/linkedin/detect";
import {
  queueScrapeJob,
  claimScrapeJob,
  completeScrapeJob,
  scrapeUsageToday,
  importScrapedRows,
  flagKnownRows,
  describeOutcome,
  type ScrapedRow,
} from "../lib/linkedin/scrape";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string, extra = "") => {
  if (c) {
    pass++;
    console.log("  ok  ", m, extra);
  } else {
    fail++;
    console.log("  FAIL", m, extra);
  }
};

const row = (n: string, url: string): ScrapedRow => ({
  profileUrl: url,
  fullName: n,
  headline: `Head of HR at Acme`,
  company: "Acme",
  degree: "2nd",
});

async function main() {
  const stamp = Date.now();
  const org = await prisma.organization.create({ data: { name: "scrape-test", slug: `scrape-test-${stamp}` } });
  const orgId = org.id;

  const mk = async (handle: string) => {
    const u = await prisma.user.create({
      data: { name: handle, email: `${handle}-${stamp}@t.local`, emailVerified: true },
    });
    await prisma.member.create({ data: { organizationId: orgId, userId: u.id, role: "member" } });
    await prisma.linkedInAccount.create({
      data: { organizationId: orgId, userId: u.id, extToken: `tok-${handle}-${stamp}`, status: "connected", dailyScrapeCap: 10 },
    });
    return u.id;
  };
  const rep = await mk("rep");
  const other = await mk("other");

  // ---- queue + clamp -------------------------------------------------------
  const d = detectScrapeKind("https://www.linkedin.com/search/results/people/?keywords=hr")!;
  const job = await queueScrapeJob({
    organizationId: orgId, userId: rep, kind: d.kind, inputUrl: d.url, maxResults: 99999,
  });
  ok(job.maxResults === 1000, "maxResults is clamped to LinkedIn's own cap, not what the client asked", `${job.maxResults}`);
  ok(job.status === "queued", "a new job is queued");

  // ---- claiming ------------------------------------------------------------
  const claimed = await claimScrapeJob(orgId, rep);
  ok(claimed?.id === job.id, "the rep's extension claims its job");
  ok(claimed!.maxResults === 10, "the claim is capped to what is left today, not what the job wanted", `${claimed!.maxResults}`);

  const second = await claimScrapeJob(orgId, rep);
  ok(second === null, "a second poll while one is running gets nothing — no stacking tabs");

  const otherClaim = await claimScrapeJob(orgId, other);
  ok(otherClaim === null, "another rep's extension cannot claim this rep's job");

  // ---- the two kinds of nothing -------------------------------------------
  const empty = await queueScrapeJob({ organizationId: orgId, userId: other, kind: "search_export", inputUrl: d.url, maxResults: 50 });
  await claimScrapeJob(orgId, other);
  await completeScrapeJob({ organizationId: orgId, jobId: empty.id, rows: [], failureKind: "empty" });
  const emptyJob = (await prisma.linkedInScrapeJob.findUnique({ where: { id: empty.id } }))!;
  ok(emptyJob.status === "done", "an empty page is a completed job, not a failure");
  ok(describeOutcome(emptyJob).includes("nothing on it"), "and says the page was empty", describeOutcome(emptyJob));

  const broken = await queueScrapeJob({ organizationId: orgId, userId: other, kind: "search_export", inputUrl: d.url, maxResults: 50 });
  await completeScrapeJob({ organizationId: orgId, jobId: broken.id, failureKind: "selector_miss" });
  const brokenJob = (await prisma.linkedInScrapeJob.findUnique({ where: { id: broken.id } }))!;
  ok(brokenJob.status === "failed", "a selector miss IS a failure");
  ok(describeOutcome(brokenJob).includes("changed its layout"), "and blames us, not the search", describeOutcome(brokenJob));

  // ---- results + in-batch dedupe ------------------------------------------
  const dupUrl = "https://www.linkedin.com/in/dup-person";
  const res = await completeScrapeJob({
    organizationId: orgId,
    jobId: job.id,
    rows: [
      row("Asha Rao", "https://www.linkedin.com/in/asha-rao"),
      row("Vikram Shah", "https://www.linkedin.com/in/vikram-shah"),
      row("Dup Person", dupUrl),
      row("Dup Person", dupUrl), // LinkedIn repeats people across search pages
    ],
  });
  ok(res.stored === 3 && res.deduped === 1, "duplicates within one scrape are dropped before review", `stored=${res.stored}`);

  // ---- usage counts rows, not jobs ----------------------------------------
  const usage = await scrapeUsageToday(orgId, rep);
  ok(usage.used === 3, "usage counts rows pulled, not jobs run", `used=${usage.used}`);
  ok(usage.remaining === 7, "remaining reflects the cap", `remaining=${usage.remaining}`);

  // ---- known-contact flagging ---------------------------------------------
  const existing = await prisma.lead.create({
    data: { organizationId: orgId, firstName: "Asha", linkedinUrl: "https://www.linkedin.com/in/asha-rao" },
  });
  await prisma.contactIdentity.create({
    data: { organizationId: orgId, leadId: existing.id, kind: "linkedin", value: "linkedin.com/in/asha-rao" },
  });
  const stored = (await prisma.linkedInScrapeJob.findUnique({ where: { id: job.id } }))!
    .results as unknown as ScrapedRow[];
  const known = await flagKnownRows(orgId, stored);
  ok(known.some(Boolean), "a row we already have is flagged before import, not merged silently", `${known.filter(Boolean).length} known`);

  // ---- import goes through the identity graph ------------------------------
  const imported = await importScrapedRows({ organizationId: orgId, jobId: job.id, rowIndexes: [1] });
  ok(imported.received === 1, "only the ticked rows are imported", `received=${imported.received}`);
  const vikram = await prisma.lead.findFirst({ where: { organizationId: orgId, firstName: "Vikram" } });
  ok(!!vikram, "the chosen row became a contact");
  ok(!!vikram?.leadSourceId, "tagged with a LinkedIn source, so ROI and assignment rules can target it");

  const total = await prisma.lead.count({ where: { organizationId: orgId } });
  ok(total === 2, "the unticked rows did NOT become contacts", `${total} leads`);

  // ---- a stale claim is released, not stuck forever ------------------------
  const orphan = await queueScrapeJob({ organizationId: orgId, userId: rep, kind: "search_export", inputUrl: d.url, maxResults: 10 });
  await prisma.linkedInScrapeJob.update({
    where: { id: orphan.id },
    data: { status: "running", startedAt: new Date(Date.now() - 60 * 60_000) }, // laptop closed an hour ago
  });
  await prisma.linkedInAccount.updateMany({ where: { organizationId: orgId, userId: rep }, data: { dailyScrapeCap: 100 } });
  const reclaimed = await claimScrapeJob(orgId, rep);
  ok(reclaimed?.id === orphan.id, "an abandoned job is reclaimed rather than blocking the queue forever");

  // cleanup
  await prisma.contactIdentity.deleteMany({ where: { organizationId: orgId } });
  await prisma.linkedInScrapeJob.deleteMany({ where: { organizationId: orgId } });
  await prisma.linkedInAccount.deleteMany({ where: { organizationId: orgId } });
  await prisma.pipelineItem.deleteMany({ where: { organizationId: orgId } });
  await prisma.pipelineStage.deleteMany({ where: { pipeline: { organizationId: orgId } } });
  await prisma.pipeline.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversationEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.task.deleteMany({ where: { organizationId: orgId } });
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.leadSource.deleteMany({ where: { organizationId: orgId } });
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [rep, other] } } });
  await prisma.organization.delete({ where: { id: orgId } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
