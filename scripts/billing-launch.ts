/**
 * Give every workspace that existed before billing its launch trial.
 *
 *   npx tsx --env-file=.env scripts/billing-launch.ts           # dry run: counts only
 *   npx tsx --env-file=.env scripts/billing-launch.ts --apply   # write
 *
 * Each organization without a Subscription gets 14 days of Grow, waiting to
 * start: the clock begins the first time somebody opens the workspace after
 * BILLING_ENFORCED=1 (startTrialIfWaiting, from app/dashboard/layout.tsx), so a
 * dormant workspace's trial can't run out before anyone has seen it. Credits
 * need nothing here — the first look at a day grants that day's allowance.
 *
 * Safe to run twice: workspaces that already have a subscription are left
 * alone, and the insert skips any that gain one between the count and the write.
 * Runs against DATABASE_URL, which is production — dry-run first.
 */
import { prisma } from "../lib/db";
import { LAUNCH_TRIAL, PLANS } from "../lib/billing/plans";

const apply = process.argv.includes("--apply");

async function main() {
  const [organizations, subscribed] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.subscription.findMany({ select: { organizationId: true } }),
  ]);
  const hasPlan = new Set(subscribed.map((s) => s.organizationId));
  const waiting = organizations.filter((o) => !hasPlan.has(o.id));
  const plan = PLANS[LAUNCH_TRIAL.plan];

  console.log(
    `${organizations.length} workspaces · ${hasPlan.size} already have a plan · ${waiting.length} would get ${LAUNCH_TRIAL.days} days of ${plan.name}, starting when first opened`,
  );
  for (const o of waiting.slice(0, 25)) console.log(`  - ${o.name} (since ${o.createdAt.toISOString().slice(0, 10)})`);
  if (waiting.length > 25) console.log(`  …and ${waiting.length - 25} more`);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to create the trials.");
    return;
  }
  if (!waiting.length) {
    console.log("\nNothing to do.");
    return;
  }
  const { count } = await prisma.subscription.createMany({
    data: waiting.map((o) => ({ organizationId: o.id, planId: LAUNCH_TRIAL.plan, status: "trialing" })),
    skipDuplicates: true,
  });
  console.log(`\nCreated ${count} waiting ${plan.name} trials.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
