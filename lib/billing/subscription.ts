/**
 * What a workspace is on, and whether it can still spend.
 *
 * Plans are defined in ./plans; this reads which one a workspace has and turns
 * the stored status into the one question everything else asks: can this
 * workspace do things that cost credits right now?
 */
import { prisma } from "../db";
import { LAUNCH_TRIAL, planById, type Plan } from "./plans";

const DAY_MS = 86_400_000;

/** active: paying or on a live one-time plan · trial: launch trial · expired: had one, it ended · none: never chose. */
export type Access = "active" | "trial" | "expired" | "none";

export interface WorkspacePlan {
  plan: Plan | null;
  /** The stored subscription status, or null with no subscription. */
  status: string | null;
  access: Access;
  /** When a trial or a one-time plan ends; null while a launch trial is still waiting to start. */
  endsAt: Date | null;
  /** Whole days left of a trial or one-time plan, rounded up. */
  daysLeft: number | null;
}

export async function workspacePlan(organizationId: string, now = new Date()): Promise<WorkspacePlan> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!sub) return { plan: null, status: null, access: "none", endsAt: null, daysLeft: null };
  const plan = planById(sub.planId);
  const daysUntil = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / DAY_MS));

  if (sub.status === "trialing") {
    // A launch trial nobody has opened yet has not started counting.
    if (!sub.trialEndsAt) return { plan, status: sub.status, access: "trial", endsAt: null, daysLeft: LAUNCH_TRIAL.days };
    const live = sub.trialEndsAt > now;
    return { plan, status: sub.status, access: live ? "trial" : "expired", endsAt: sub.trialEndsAt, daysLeft: daysUntil(sub.trialEndsAt) };
  }

  if (sub.status === "active" || sub.status === "past_due") {
    // The Test Drive is paid once and simply runs out. A monthly plan with no
    // razorpaySubscriptionId was charged the same way — one order, one month —
    // because Razorpay Subscriptions isn't enabled on the account yet, so it
    // runs out exactly like the Test Drive rather than staying "active"
    // forever on a single payment. Once a real subscription exists (a
    // razorpaySubscriptionId), its currentPeriodEnd is advanced by Razorpay's
    // webhook on every renewal and status flips on failure — this check no
    // longer applies to it.
    const simulatedMonthly = plan?.billing === "monthly" && !sub.razorpaySubscriptionId;
    if ((plan?.billing === "one_time" || simulatedMonthly) && sub.currentPeriodEnd) {
      const live = sub.currentPeriodEnd > now;
      return { plan, status: sub.status, access: live ? "active" : "expired", endsAt: sub.currentPeriodEnd, daysLeft: daysUntil(sub.currentPeriodEnd) };
    }
    return { plan, status: sub.status, access: "active", endsAt: null, daysLeft: null };
  }

  return { plan, status: sub.status, access: "expired", endsAt: sub.currentPeriodEnd ?? sub.trialEndsAt, daysLeft: 0 };
}

/** Whether a workspace may do things that spend credits right now. */
export const canSpend = (wp: WorkspacePlan) => wp.access === "active" || wp.access === "trial";

/**
 * Start a launch trial's 14 days the first time somebody in the workspace opens
 * the app. Conditional on it not having started, so two tabs opening at once
 * start it once, and a trial is never restarted.
 */
export async function startTrialIfWaiting(organizationId: string, now = new Date()) {
  const { count } = await prisma.subscription.updateMany({
    where: { organizationId, status: "trialing", trialStartedAt: null },
    data: { trialStartedAt: now, trialEndsAt: new Date(now.getTime() + LAUNCH_TRIAL.days * DAY_MS) },
  });
  return count > 0;
}
