/**
 * Verification for plans, credits and limits.
 *
 *   npx tsx --env-file=.env scripts/verify-credits.ts
 *
 * Runs against whatever DATABASE_URL points at — which is production, there is
 * no other — inside throwaway organizations that it deletes afterwards.
 *
 * What it holds billing to:
 *   - today's allowance is granted once a day and spent before top-ups;
 *   - the balance never goes negative, even under concurrent charges;
 *   - a charge, a refund and a top-up each happen once however often they're retried;
 *   - enrichment pays only for what it found;
 *   - plans limit what can be created, and a Test Drive runs out;
 *   - a launch trial starts counting when the workspace is first opened;
 *   - LinkedIn invitations are paid for once when handed out, and settled when
 *     they report back or are cancelled without reporting;
 *   - a workspace that runs out is told why, and its admins once a day.
 */
import { prisma } from "../lib/db";
import { addTopup, balance, dailyAllowance, release, reserve, settle } from "../lib/billing/credits";
import { checkLimit, requireLimit } from "../lib/billing/limits";
import { charge, once } from "../lib/billing/meter";
import { enrichmentCharge, packVsPlan, planCreditRate, PLANS, TOP_UP_PACKS } from "../lib/billing/plans";
import { startTrialIfWaiting, workspacePlan } from "../lib/billing/subscription";
import { claimActions, completeAction, peekActions, settleStrandedCharges } from "../lib/linkedin/queue";
import { orgDayKey } from "../lib/org-day";

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
  const org = await prisma.organization.create({ data: { name: `${name}-${stamp}`, slug: `${name}-${stamp}` } });
  orgIds.push(org.id);
  return org.id;
}
const bal = (organizationId: string) => prisma.creditBalance.findUniqueOrThrow({ where: { organizationId } });

async function main() {
  try {
    console.log("\n— plan arithmetic —");
    ok(Math.abs(planCreditRate(PLANS.start) - 10 / 3000) < 1e-9, "Start's credits cost $10 / 3,000");
    ok(
      JSON.stringify(TOP_UP_PACKS.map((p) => packVsPlan(p, PLANS.grow))) === JSON.stringify([3.8, 3, 2.3, 1.9]),
      `packs against Grow read 3.8×, 3×, 2.3×, 1.9× (got ${TOP_UP_PACKS.map((p) => packVsPlan(p, PLANS.grow)).join(", ")})`,
    );
    ok(TOP_UP_PACKS.every((p) => packVsPlan(p, PLANS.scale) > 1), "every pack costs more per credit than even Scale's own credits");
    ok(!PLANS.test_drive.topUps && PLANS.start.topUps, "a Test Drive cannot buy top-ups; Start can");

    console.log("\n— enrichment pays for what it found —");
    ok(enrichmentCharge({ connected: true, foundEmail: true, foundPhone: true }) === 3, "both found: 3");
    ok(enrichmentCharge({ connected: true, foundEmail: true, foundPhone: false }) === 2, "no phone: 2");
    ok(enrichmentCharge({ connected: true, foundEmail: false, foundPhone: false }) === 1, "neither: 1");
    ok(enrichmentCharge({ connected: false, foundEmail: false, foundPhone: false }) === 0, "not a connection: 0");
    ok(enrichmentCharge({ connected: true, failed: true, foundEmail: false, foundPhone: false }) === 0, "failed: 0");

    console.log("\n— the day's allowance and top-ups —");
    const org = await newOrg("credits");
    await prisma.subscription.create({ data: { organizationId: org, planId: "start", status: "active" } });
    ok((await dailyAllowance(org)) === 100, "Start gets 100 a day");
    let b = await balance(org);
    ok(b.dailyRemaining === 100 && b.topupRemaining === 0, "the first look at the day grants it");
    await balance(org);
    ok((await prisma.creditLedger.count({ where: { organizationId: org, kind: "grant" } })) === 1, "…once, however often it's looked at");

    ok((await addTopup(org, `p-${stamp}`, 50)) === true, "a paid top-up is credited");
    ok((await addTopup(org, `p-${stamp}`, 50)) === false, "…and a redelivered webhook credits nothing more");
    ok((await bal(org)).topupRemaining === 50, "top-up balance is 50");

    console.log("\n— charging —");
    const refA = { type: "test", id: `a-${stamp}` };
    let r = await reserve(org, "li_invite_note", refA);
    ok(r.ok && r.cost === 5 && r.fromDaily === 5, "an invite with a note reserves 5, from today's allowance");
    r = await reserve(org, "li_invite_note", refA);
    ok(r.ok && (await bal(org)).dailyRemaining === 95, "reserving the same thing again charges nothing more");

    const refB = { type: "test", id: `b-${stamp}` };
    r = await reserve(org, "email_send", refB, { cost: 97 });
    const afterB = await bal(org);
    ok(r.ok && r.fromDaily === 95 && r.fromTopup === 2, "a charge bigger than what's left today takes the rest from top-ups");
    ok(afterB.dailyRemaining === 0 && afterB.topupRemaining === 48, "…leaving 0 today and 48 in top-ups");

    const big = await reserve(org, "email_send", { type: "test", id: `c-${stamp}` }, { cost: 1000 });
    const afterBig = await bal(org);
    ok(!big.ok && afterBig.dailyRemaining === 0 && afterBig.topupRemaining === 48, "a charge that doesn't fit takes nothing");

    console.log("\n— settling —");
    let s = await settle(org, refA);
    ok(s.kept === 5 && s.returned === 0, "a completed action keeps what it reserved");
    s = await settle(org, refB, 90, "partial");
    const afterRefund = await bal(org);
    ok(s.returned === 7 && afterRefund.topupRemaining === 50 && afterRefund.dailyRemaining === 5, "a partial refund goes back to top-ups first, then today");
    s = await settle(org, refB, 0);
    ok(s.repeat && (await bal(org)).topupRemaining === 50, "settling twice changes nothing");

    const refD = { type: "test", id: `d-${stamp}` };
    await reserve(org, "li_invite", refD);
    const beforeRelease = await bal(org);
    await release(org, refD, "failed");
    const afterRelease = await bal(org);
    ok(afterRelease.dailyRemaining === beforeRelease.dailyRemaining + 3, "a failed action gets everything back");

    const refE = { type: "test", id: `e-${stamp}` };
    await reserve(org, "li_invite", refE);
    await prisma.creditLedger.updateMany({ where: { refId: refE.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const beforeOld = await bal(org);
    await release(org, refE, "failed, days later");
    const afterOld = await bal(org);
    ok(
      afterOld.topupRemaining === beforeOld.topupRemaining + 3 && afterOld.dailyRemaining === beforeOld.dailyRemaining,
      "a daily credit reserved on an earlier day comes back as a top-up, not into today's allowance",
    );

    console.log("\n— concurrency —");
    await prisma.creditBalance.update({ where: { organizationId: org }, data: { dailyRemaining: 15, topupRemaining: 0 } });
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => reserve(org, "email_send", { type: "test", id: `race-${stamp}-${i}` }).catch((e) => ({ ok: false as const, error: String(e) }))),
    );
    const won = results.filter((x) => x.ok).length;
    const final = await bal(org);
    ok(won === 15, `25 simultaneous 1-credit charges against 15 credits: exactly 15 succeed (got ${won})`);
    ok(final.dailyRemaining === 0 && final.topupRemaining === 0, `…and the balance ends at zero, never below (daily ${final.dailyRemaining}, top-up ${final.topupRemaining})`);

    console.log("\n— limits and plans —");
    process.env.BILLING_ENFORCED = "1";
    const td = await newOrg("testdrive");
    await prisma.subscription.create({
      data: { organizationId: td, planId: "test_drive", status: "active", currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000) },
    });
    ok((await checkLimit(td, "campaigns")).ok, "a Test Drive can create its first campaign");
    await prisma.campaign.create({ data: { organizationId: td, name: `c-${stamp}` } });
    const second = await checkLimit(td, "campaigns");
    ok(!second.ok && /Test Drive plan includes 1 campaign/.test(second.ok ? "" : second.message), "…but not a second, and says why");
    const refused = await requireLimit(td, "campaigns");
    ok(refused?.status === 402, "routes get a 402 for it");
    ok((await workspacePlan(td)).access === "active", "a Test Drive with days left is active");
    await prisma.subscription.update({ where: { organizationId: td }, data: { currentPeriodEnd: new Date(Date.now() - 86_400_000) } });
    ok((await workspacePlan(td)).access === "expired" && (await dailyAllowance(td)) === 0, "once its 14 days are up it's expired, with no allowance");

    const none = await newOrg("noplan");
    ok((await workspacePlan(none)).access === "none" && (await dailyAllowance(none)) === 0, "a workspace with no plan has no allowance");
    process.env.BILLING_ENFORCED = "";
    ok((await requireLimit(none, "campaigns")) === null, "…but nothing is refused while billing isn't enforced");

    console.log("\n— the launch trial starts on first visit —");
    const trial = await newOrg("trial");
    await prisma.subscription.create({ data: { organizationId: trial, planId: "grow", status: "trialing" } });
    let wp = await workspacePlan(trial);
    ok(wp.access === "trial" && wp.endsAt === null && wp.daysLeft === 14, "an unopened trial is waiting, with all 14 days");
    ok((await startTrialIfWaiting(trial)) === true, "opening the workspace starts it");
    ok((await startTrialIfWaiting(trial)) === false, "…and opening it again doesn't restart it");
    wp = await workspacePlan(trial);
    ok(wp.access === "trial" && wp.daysLeft === 14 && !!wp.endsAt, "it now ends 14 days from today");

    console.log("\n— charging through the app —");
    const off = await charge(none, "email_send");
    ok(off.ok && off.ref === null, "with billing off, nothing is charged and nothing is refused");
    process.env.BILLING_ENFORCED = "1";
    const noPlan = await charge(none, "email_send");
    ok(!noPlan.ok && noPlan.reason === "no_plan" && noPlan.message === "Choose a plan to start sending.", "with billing on, a workspace with no plan is told to choose one");
    const ended = await charge(td, "email_send");
    ok(!ended.ok && ended.reason === "no_plan" && ended.message.startsWith("Your Test Drive has ended"), "an ended Test Drive says it has ended");
    const onceKey = `verify-once:${stamp}`;
    ok((await once(onceKey, "verify")) && !(await once(onceKey, "verify")), "once() is true the first time and false after");
    await prisma.billingEvent.deleteMany({ where: { id: onceKey } });

    console.log("\n— LinkedIn invitations —");
    const li = await newOrg("linkedin");
    await prisma.subscription.create({ data: { organizationId: li, planId: "start", status: "active" } });
    await balance(li);
    await prisma.creditBalance.update({ where: { organizationId: li }, data: { dailyRemaining: 7, topupRemaining: 0 } });
    const lead = await prisma.lead.create({
      data: { organizationId: li, firstName: "Credit", lastName: "Check", linkedinUrl: `https://www.linkedin.com/in/credit-check-${stamp}` },
    });
    const queue = async (type: string, note: string | null, noteChoice: string | null) => {
      const a = await prisma.linkedInAction.create({
        data: { organizationId: li, leadId: lead.id, linkedinUrl: lead.linkedinUrl!, type, note, noteChoice, status: "pending" },
      });
      await new Promise((r) => setTimeout(r, 20));
      return a;
    };
    const withNote = await queue("invite", "Good to meet you", "yes");
    const plain = await queue("invite", null, "no");
    const dm = await queue("message", "Hello again", null);
    const account = { organizationId: li, dailyInviteCap: 20, mode: "auto", selectedCampaignIds: [], campaignSettings: {}, accountType: "premium" };

    const peek = await peekActions(account, 10);
    ok(
      peek.people.map((p) => p.id).join() === [withNote.id, dm.id].join() && peek.held.some((h) => h.id === plain.id && h.hold === "no_credits"),
      "7 credits cover an invitation with a note (5) and a message (2); the plain invitation (3) waits for credits",
    );
    ok((await bal(li)).dailyRemaining === 7 && peek.credits?.available === 7, "…and looking at the queue spends nothing");

    const claimed = await claimActions(account, 10);
    ok(claimed.map((a) => a.id).join() === [withNote.id, dm.id].join(), "the claim hands out exactly what peek showed");
    ok((await bal(li)).dailyRemaining === 0, "…and charges for them: 7 − 5 − 2 = 0");

    await prisma.linkedInAction.update({ where: { id: withNote.id }, data: { status: "pending" } });
    const again = await claimActions(account, 10);
    ok(again.some((a) => a.id === withNote.id) && (await bal(li)).dailyRemaining === 0, "an invitation put back in the queue goes out again without paying twice");

    await completeAction(li, { actionId: withNote.id, status: "sent" });
    ok((await bal(li)).dailyRemaining === 0, "a sent invitation with a note keeps its 5");
    await completeAction(li, { actionId: dm.id, status: "failed" });
    ok((await bal(li)).dailyRemaining === 2, "a failed message gets its 2 back");

    await prisma.creditBalance.update({ where: { organizationId: li }, data: { dailyRemaining: 3 } });
    const [third] = await claimActions(account, 10);
    ok(third?.id === plain.id && (await bal(li)).dailyRemaining === 0, "with 3 credits, the plain invitation goes");
    await prisma.linkedInAction.update({ where: { id: plain.id }, data: { status: "skipped", result: "campaign deleted" } });
    // A cutoff a minute ahead, so the database's clock running a little ahead of this one can't hide the rows.
    const swept = await settleStrandedCharges({ organizationId: li, olderThanMs: -60_000 });
    ok(swept.returned === 1 && swept.kept === 0 && (await bal(li)).dailyRemaining === 3, "an invitation cancelled without a report gets its credits back in the sweep");
    ok((await settleStrandedCharges({ organizationId: li, olderThanMs: -60_000 })).checked === 0, "…once, and leaves settled ones alone");

    console.log("\n— running out —");
    await prisma.creditBalance.update({ where: { organizationId: li }, data: { dailyRemaining: 0 } });
    const broke = await charge(li, "email_send", { ref: { type: "test", id: `broke-${stamp}` } });
    ok(!broke.ok && broke.reason === "no_credits" && /midnight/.test(broke.message) && /Buy credits/.test(broke.message), "a paid plan out of credits is told when it resumes and where to buy more");
    const noticeId = `credits-out:${li}:${await orgDayKey(li)}`;
    ok((await prisma.billingEvent.count({ where: { id: noticeId } })) === 1, "…and its admins' email is recorded for the day");
    await charge(li, "email_send", { ref: { type: "test", id: `broke-2-${stamp}` } });
    ok((await prisma.billingEvent.count({ where: { id: noticeId } })) === 1, "…once, however many sends are refused");
    process.env.BILLING_ENFORCED = "";
  } finally {
    for (const organizationId of orgIds) {
      await prisma.message.deleteMany({ where: { organizationId } });
      // Takes its actions, activity and conversation events with it.
      await prisma.lead.deleteMany({ where: { organizationId } });
      await prisma.billingEvent.deleteMany({ where: { id: { contains: organizationId } } });
      await prisma.creditLedger.deleteMany({ where: { organizationId } });
      await prisma.creditBalance.deleteMany({ where: { organizationId } });
      await prisma.creditPurchase.deleteMany({ where: { organizationId } });
      await prisma.subscription.deleteMany({ where: { organizationId } });
      await prisma.campaign.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
