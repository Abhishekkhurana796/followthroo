/**
 * Verification for LinkedIn enrichment (P2): the credit engine, the CRM merge,
 * and a campaign's Enrich step parking and resuming an enrollment.
 *
 *   npx tsx --env-file=.env scripts/verify-linkedin-enrichment.ts
 *
 * Runs against DATABASE_URL — production, there is no other — inside a
 * throwaway organization it deletes afterward. BILLING_ENFORCED is turned on
 * for the duration of this script only, so credits are actually charged; the
 * plan and credit balance it needs are given directly to the org rather than
 * read from a real subscription.
 *
 * NODE_ENV is forced to "development" before anything else runs: the campaign
 * engine's scheduleAdvance goes through lib/queue.ts's enqueueJob, which without
 * QStash configured only runs a job inline when NODE_ENV is "development" —
 * otherwise it logs "job dropped" and does nothing, which is correct for a real
 * deployment missing its queue config, but would make every resumed-enrollment
 * assertion below unwaitable.
 */
(process.env as Record<string, string>).NODE_ENV = "development";
import { prisma } from "../lib/db";
import { balance } from "../lib/billing/credits";
import { claimEnrichments, completeEnrichment, enqueueEnrichment, estimateEnrichment } from "../lib/linkedin/enrich";
import { resumeAfterEnrich } from "../lib/campaign-engine";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) {
    pass++;
    console.log("  ok  ", m);
  } else {
    fail++;
    console.log("  FAIL", m);
  }
};

const stamp = Date.now();
const orgIds: string[] = [];
async function newOrg(name: string) {
  const org = await prisma.organization.create({ data: { name: `enrich-${name}-${stamp}`, slug: `enrich-${name}-${stamp}` } });
  orgIds.push(org.id);
  await prisma.subscription.create({ data: { organizationId: org.id, planId: "start", status: "active" } });
  await balance(org.id); // opens the day, grants the allowance
  return org.id;
}
const bal = (organizationId: string) => prisma.creditBalance.findUniqueOrThrow({ where: { organizationId } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a condition that a real deployment would reach through QStash
 * delivering a job over HTTP, but which this script — with no QStash token —
 * reaches through lib/queue.ts's dev-mode fallback: an un-awaited
 * `setTimeout(..., delay)`. A `delay` of 0 still means "after this tick", not
 * "before your next line runs" — so anything that depends on a scheduled
 * advance actually having fired is polled, bounded, rather than raced.
 */
async function waitFor(check: () => Promise<boolean>, tries = 20, gapMs = 150) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await sleep(gapMs);
  }
  return false;
}

async function main() {
  process.env.BILLING_ENFORCED = "1";
  try {
    console.log("\n— claiming and charging —");
    const org = await newOrg("charge");
    const account = { organizationId: org, dailyEnrichCap: 2 };

    const lead = async (n: number) =>
      prisma.lead.create({ data: { organizationId: org, firstName: `Lead ${n}`, linkedinUrl: `https://www.linkedin.com/in/lead-${n}-${stamp}` } });
    const l1 = await lead(1);
    const l2 = await lead(2);
    const l3 = await lead(3);

    await enqueueEnrichment({ organizationId: org, leadId: l1.id, linkedinUrl: l1.linkedinUrl!, source: "manual" });
    await enqueueEnrichment({ organizationId: org, leadId: l2.id, linkedinUrl: l2.linkedinUrl!, source: "manual" });
    await enqueueEnrichment({ organizationId: org, leadId: l3.id, linkedinUrl: l3.linkedinUrl!, source: "manual" });
    const dup = await enqueueEnrichment({ organizationId: org, leadId: l1.id, linkedinUrl: l1.linkedinUrl!, source: "manual" });
    const first = await prisma.linkedInEnrichment.findFirst({ where: { organizationId: org, leadId: l1.id } });
    ok(dup.id === first!.id, "queuing the same lead twice does not create a second row");

    const claimed = await claimEnrichments(account, 10);
    ok(claimed.length === 2, `dailyEnrichCap of 2 hands out exactly 2 (got ${claimed.length})`);
    ok((await bal(org)).dailyRemaining === 100 - 6, "each claim reserves 3 credits");

    const third = await claimEnrichments(account, 10);
    ok(third.length === 0, "the daily cap holds the third back even though credits remain");

    console.log("\n— what each outcome costs —");
    const r1 = await completeEnrichment(org, { enrichmentId: claimed[0].id, status: "done", degree: "1st", email: "a@example.com", phone: "+911234567890" });
    ok(r1?.charged === 3, "found both: charged 3");
    const r2 = await completeEnrichment(org, { enrichmentId: claimed[1].id, status: "skipped", degree: "2nd" });
    ok(r2?.charged === 0, "not a 1st-degree connection: charged 0, refunded");
    ok((await bal(org)).dailyRemaining === 100 - 3, "…so the balance reflects only the one that found something");

    console.log("\n— technical failures retry before they cost anything —");
    const l4 = await lead(4);
    await enqueueEnrichment({ organizationId: org, leadId: l4.id, linkedinUrl: l4.linkedinUrl!, source: "manual" });
    await prisma.linkedInAccount.deleteMany({ where: { organizationId: org } }); // irrelevant row, keeps claim below isolated
    const claim2 = await claimEnrichments({ organizationId: org, dailyEnrichCap: 50 }, 1);
    const afterClaim = await bal(org);
    const retry1 = await completeEnrichment(org, { enrichmentId: claim2[0].id, status: "failed", result: "profile did not load" });
    ok(retry1?.retrying === true, "a technical failure is retried rather than charged");
    ok((await bal(org)).dailyRemaining === afterClaim.dailyRemaining + 3, "…its 3 credits are returned while it waits to retry");
    const row = await prisma.linkedInEnrichment.findUniqueOrThrow({ where: { id: claim2[0].id } });
    ok(row.status === "pending" && row.attempts === 1, "it goes back to pending with attempts recorded");

    console.log("\n— merging into the CRM —");
    const org2 = await newOrg("merge");
    const withEmail = await prisma.lead.create({
      data: { organizationId: org2, firstName: "Has", lastName: "Email", email: "existing@example.com", linkedinUrl: `https://www.linkedin.com/in/has-email-${stamp}` },
    });
    const bare = await prisma.lead.create({
      data: { organizationId: org2, firstName: "No", lastName: "Contact", linkedinUrl: `https://www.linkedin.com/in/bare-${stamp}` },
    });
    const e1 = await enqueueEnrichment({ organizationId: org2, leadId: withEmail.id, linkedinUrl: withEmail.linkedinUrl!, source: "manual" });
    const e2 = await enqueueEnrichment({ organizationId: org2, leadId: bare.id, linkedinUrl: bare.linkedinUrl!, source: "manual" });
    await prisma.linkedInEnrichment.updateMany({ where: { id: { in: [e1.id, e2.id] } }, data: { status: "in_progress" } });
    await completeEnrichment(org2, { enrichmentId: e1.id, status: "done", degree: "1st", email: "found-on-linkedin@example.com" });
    await completeEnrichment(org2, { enrichmentId: e2.id, status: "done", degree: "1st", email: "new@example.com", phone: "+15551234567" });

    const afterWithEmail = await prisma.lead.findUniqueOrThrow({ where: { id: withEmail.id } });
    ok(afterWithEmail.email === "existing@example.com", "an existing email is kept as the primary");
    const extra = await prisma.contactIdentity.findFirst({ where: { organizationId: org2, leadId: withEmail.id, kind: "email" } });
    ok(extra?.value === "found-on-linkedin@example.com", "LinkedIn's different email is added as an extra identity");

    const afterBare = await prisma.lead.findUniqueOrThrow({ where: { id: bare.id } });
    ok(afterBare.email === "new@example.com" && afterBare.phone === "+15551234567", "with nothing on file, LinkedIn's values become the primary");

    console.log("\n— a campaign's Enrich step —");
    const org3 = await newOrg("campaign");
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: org3,
        name: `enrich-step-${stamp}`,
        status: "active",
        sequence: {
          nodes: [
            { id: "n0", type: "enrich", next: "n1" },
            { id: "n1", type: "exit" },
          ],
          startNodeId: "n0",
        },
      },
    });
    const leadC = await prisma.lead.create({
      data: { organizationId: org3, firstName: "Campaign", linkedinUrl: `https://www.linkedin.com/in/campaign-lead-${stamp}` },
    });
    const enr = await prisma.enrollment.create({
      data: { organizationId: org3, campaignId: campaign.id, leadId: leadC.id, status: "active", currentNodeId: "n0", nextRunAt: new Date() },
    });
    const { advanceEnrollment } = await import("../lib/campaign-engine");
    await advanceEnrollment(enr.id);
    const parked = await prisma.enrollment.findUniqueOrThrow({ where: { id: enr.id } });
    ok(parked.currentNodeId === "n0" && parked.status === "active", "advancing an enrich node parks the enrollment on it");
    ok((parked.nextRunAt?.getTime() ?? 0) > Date.now() + 6 * 86_400_000, "…for about 7 days, in case nothing ever completes it");
    const queuedRow = await prisma.linkedInEnrichment.findFirstOrThrow({ where: { enrollmentId: enr.id, nodeId: "n0" } });
    ok(queuedRow.status === "pending" && queuedRow.source === "campaign", "…and queues a lookup tied to this enrollment and node");

    await prisma.linkedInEnrichment.update({ where: { id: queuedRow.id }, data: { status: "in_progress" } });
    await completeEnrichment(org3, { enrichmentId: queuedRow.id, status: "done", degree: "1st", email: "campaign-lead@example.com" });
    // resumeAfterEnrich schedules the next hop through lib/queue.ts rather than
    // running it inline — see waitFor above for why this polls rather than
    // reading the row back immediately.
    const gotThere = await waitFor(async () => (await prisma.enrollment.findUniqueOrThrow({ where: { id: enr.id } })).status === "completed");
    ok(gotThere, "completing the lookup resumes the enrollment past the Enrich step immediately, not at the 7-day mark");

    console.log("\n— the 7-day timeout, simulated —");
    const leadD = await prisma.lead.create({
      data: { organizationId: org3, firstName: "Timeout", linkedinUrl: `https://www.linkedin.com/in/timeout-lead-${stamp}` },
    });
    const enr2 = await prisma.enrollment.create({
      data: { organizationId: org3, campaignId: campaign.id, leadId: leadD.id, status: "active", currentNodeId: "n0", nextRunAt: new Date(0) },
    });
    await advanceEnrollment(enr2.id); // first call: queues + parks
    await prisma.enrollment.update({ where: { id: enr2.id }, data: { nextRunAt: new Date(0) } }); // fast-forward past the 7 days
    await advanceEnrollment(enr2.id); // second call: this IS the timeout firing — moves on to n1 (exit)
    const timedOutMoved = await waitFor(async () => (await prisma.enrollment.findUniqueOrThrow({ where: { id: enr2.id } })).currentNodeId === "n1");
    ok(timedOutMoved, "an enrich step that never resolves moves the sequence on after 7 days");
    const timedOut = await waitFor(async () => (await prisma.enrollment.findUniqueOrThrow({ where: { id: enr2.id } })).status === "completed");
    ok(timedOut, "…and it reaches the end, unblocked");

    console.log("\n— estimate —");
    const est = await estimateEnrichment(org3, [leadC.id, withEmail.id]);
    ok(est.eligible >= 1, "estimateEnrichment reports at least the leads with a LinkedIn URL");

    // resumeAfterEnrich is exercised above via completeEnrichment; call it directly too,
    // confirming it is a no-op once the enrollment has already moved on.
    await resumeAfterEnrich(enr.id, "n0");
    const stillDone = await prisma.enrollment.findUniqueOrThrow({ where: { id: enr.id } });
    ok(stillDone.status === "completed", "resumeAfterEnrich is a no-op once the enrollment has already moved past that node");
  } finally {
    for (const organizationId of orgIds) {
      await prisma.linkedInEnrichment.deleteMany({ where: { organizationId } });
      await prisma.contactIdentity.deleteMany({ where: { organizationId } });
      await prisma.enrollment.deleteMany({ where: { organizationId } });
      await prisma.campaign.deleteMany({ where: { organizationId } });
      await prisma.lead.deleteMany({ where: { organizationId } });
      await prisma.creditLedger.deleteMany({ where: { organizationId } });
      await prisma.creditBalance.deleteMany({ where: { organizationId } });
      await prisma.subscription.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
    process.env.BILLING_ENFORCED = "";
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
