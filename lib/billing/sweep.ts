/**
 * The billing sweep: what has to happen on a clock rather than because somebody
 * did something. Run by /api/cron/billing-sweep every 15 minutes.
 *
 *  - Credits still held by LinkedIn invitations that will never report back — a
 *    deleted campaign, "Stop everything", a deleted lead — are settled.
 *  - A trial or Test Drive near its end emails the workspace's admins at 7, 3
 *    and 1 days left, and once when it ends.
 *
 * Safe to run as often as it likes: a settled charge doesn't settle twice, and
 * each reminder is keyed so it goes once.
 */
import { prisma } from "../db";
import { env } from "../env";
import { settleStrandedCharges } from "../linkedin/queue";
import { billingEnforced } from "./limits";
import { emailAdmins, once } from "./meter";
import { planById } from "./plans";

const DAY_MS = 86_400_000;

export async function sweepBilling(now = new Date()) {
  const stranded = await settleStrandedCharges();
  // Reminders only once billing is real: "your trial ends in 3 days" means
  // nothing while nothing stops when it does.
  const reminders = billingEnforced() ? await remindPlansEnding(now) : 0;
  return { stranded, reminders };
}

async function remindPlansEnding(now: Date) {
  const window = { gte: new Date(now.getTime() - 2 * DAY_MS), lte: new Date(now.getTime() + 7 * DAY_MS) };
  const subs = await prisma.subscription.findMany({
    where: {
      OR: [
        { status: "trialing", trialEndsAt: window },
        // The Test Drive, and a monthly plan charged the same one-order way
        // because Razorpay Subscriptions isn't switched on yet (see
        // subscription.ts and payments.ts's "plan" grant) — both run out at
        // currentPeriodEnd with nothing re-charging them automatically. A real
        // subscription (razorpaySubscriptionId set) is excluded: its renewal
        // and any failure notice come from Razorpay itself.
        { status: { in: ["active", "past_due"] }, razorpaySubscriptionId: null, currentPeriodEnd: window },
      ],
    },
    select: { organizationId: true, planId: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });

  let sent = 0;
  for (const sub of subs) {
    const endsAt = sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd;
    const plan = planById(sub.planId);
    if (!endsAt || !plan) continue;
    const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS);
    const stage = daysLeft <= 0 ? "ended" : daysLeft <= 1 ? "1" : daysLeft <= 3 ? "3" : "7";
    // Keyed on the end date as well, so a Test Drive bought after a trial gets reminders of its own.
    if (!(await once(`ending:${sub.organizationId}:${endsAt.toISOString()}:${stage}`, "notice.plan_ending"))) continue;

    const what = sub.status === "trialing" ? `${plan.name} trial` : plan.name;
    const link = `${env.appUrl}/dashboard/settings/billing`;
    const [subject, body] =
      stage === "ended"
        ? [
            `Your ${what} has ended`,
            `Your ${what} has ended, so campaigns, LinkedIn invitations and AI drafts have stopped.\n\n` +
              `Nothing is deleted: your leads, conversations and reports are all still there. Choose a plan to carry on where you left off:\n${link}`,
          ]
        : [
            `Your ${what} ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
            `Your ${what} ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}. After that, campaigns, LinkedIn invitations and AI drafts stop until you choose a plan.\n\n` +
              `Nothing is deleted when it ends. Choose a plan before then and nothing pauses:\n${link}`,
          ];
    if (await emailAdmins(sub.organizationId, subject, body)) sent++;
  }
  return sent;
}
