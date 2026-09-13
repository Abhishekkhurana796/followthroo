/**
 * Turning a paid Razorpay order into what it bought.
 *
 * Two things can report the same payment: Checkout, whose signature the browser
 * brings straight back to /api/billing/verify, and — once it's configured — the
 * payment.captured webhook. Whichever arrives first grants; the other changes
 * nothing. What was bought, and for which workspace, is always read from the
 * order's own notes, set by the server when it created the order, never from
 * whatever the browser says.
 */
import { prisma } from "../db";
import { addTopup } from "./credits";
import { once } from "./meter";
import { PLANS, planById } from "./plans";
import type { RazorpayOrder } from "./razorpay";

const DAY_MS = 86_400_000;

export type Grant =
  | { kind: "pack"; credits: number; fresh: boolean }
  | { kind: "test_drive"; endsAt: Date; fresh: boolean }
  | { kind: "plan"; planId: string; endsAt: Date; fresh: boolean };

export async function grantOrder(order: RazorpayOrder, paymentId: string): Promise<Grant> {
  const organizationId = order.notes?.organizationId;
  const kind = order.notes?.kind;
  if (!organizationId) throw new Error(`Razorpay order ${order.id} names no workspace`);

  if (kind === "pack") {
    const purchase = order.notes?.purchaseId
      ? await prisma.creditPurchase.findFirst({ where: { id: order.notes.purchaseId, organizationId } })
      : null;
    if (!purchase) throw new Error(`Razorpay order ${order.id} has no purchase behind it`);
    await prisma.creditPurchase.updateMany({
      where: { id: purchase.id, status: { not: "paid" } },
      data: { status: "paid", razorpayPaymentId: paymentId },
    });
    // Keyed on the purchase, so a second report of the same payment credits nothing.
    const fresh = await addTopup(organizationId, purchase.id, purchase.credits);
    // Campaign steps waiting for credits go now, not at midnight. Imported here
    // rather than at the top: the campaign engine sits on the whole send path.
    if (fresh) {
      const { resumeWaitingForCredits } = await import("../campaign-engine");
      await resumeWaitingForCredits(organizationId).catch((e) => console.error("[billing] resuming waiting steps failed:", e));
    }
    return { kind, credits: purchase.credits, fresh };
  }

  if (kind === "test_drive") {
    const plan = PLANS.test_drive;
    const existing = await prisma.subscription.findUnique({ where: { organizationId }, select: { currentPeriodEnd: true, planId: true } });
    if (!(await once(`payment:${paymentId}`, "payment.test_drive"))) {
      return { kind, endsAt: existing?.currentPeriodEnd ?? new Date(), fresh: false };
    }
    const endsAt = new Date(Date.now() + (plan.days ?? 14) * DAY_MS);
    await prisma.subscription.upsert({
      where: { organizationId },
      create: { organizationId, planId: plan.id, status: "active", currentPeriodEnd: endsAt },
      update: { planId: plan.id, status: "active", currentPeriodEnd: endsAt, trialStartedAt: null, trialEndsAt: null, cancelledAt: null },
    });
    return { kind, endsAt, fresh: true };
  }

  if (kind === "plan") {
    const planId = order.notes?.planId ?? "";
    const plan = planById(planId);
    if (!plan || plan.billing !== "monthly") throw new Error(`Razorpay order ${order.id} names no monthly plan`);
    const existing = await prisma.subscription.findUnique({ where: { organizationId }, select: { currentPeriodEnd: true } });
    if (!(await once(`payment:${paymentId}`, "payment.plan"))) {
      return { kind, planId: plan.id, endsAt: existing?.currentPeriodEnd ?? new Date(), fresh: false };
    }
    // One month, charged once — a stand-in for a Razorpay Subscription until
    // Subscriptions is enabled on the account (it needs the business bank
    // account linked; see lib/billing/razorpay.ts createSubscription, unused
    // for now). subscription.ts's expiry check treats a monthly plan with no
    // razorpaySubscriptionId as running out at currentPeriodEnd, exactly like
    // the Test Drive, since nothing here re-charges it automatically.
    const endsAt = new Date(Date.now() + 30 * DAY_MS);
    await prisma.subscription.upsert({
      where: { organizationId },
      create: { organizationId, planId: plan.id, status: "active", currentPeriodEnd: endsAt },
      update: { planId: plan.id, status: "active", currentPeriodEnd: endsAt, trialStartedAt: null, trialEndsAt: null, cancelledAt: null },
    });
    const { resumeWaitingForCredits } = await import("../campaign-engine");
    await resumeWaitingForCredits(organizationId).catch((e) => console.error("[billing] resuming waiting steps failed:", e));
    return { kind, planId: plan.id, endsAt, fresh: true };
  }

  throw new Error(`Razorpay order ${order.id} is for "${kind}", which nothing here grants`);
}
