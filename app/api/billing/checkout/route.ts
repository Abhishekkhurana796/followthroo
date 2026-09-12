import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { PLANS, TOP_UP_PACKS } from "@/lib/billing/plans";
import { canSpend, workspacePlan } from "@/lib/billing/subscription";
import { createOrder, razorpayConfigured, razorpayKeyId, RazorpayError } from "@/lib/billing/razorpay";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test_drive") }),
  z.object({ kind: z.literal("pack"), packId: z.enum(["pack_500", "pack_1500", "pack_5000", "pack_15000"]) }),
]);

/**
 * POST /api/billing/checkout — start a one-time payment: the $2 Test Drive, or a
 * top-up pack. Creates the Razorpay order and returns what Checkout needs to
 * open. Nothing is granted here; /api/billing/verify does that once Razorpay has
 * signed the payment.
 *
 * Monthly plans aren't here: they're Razorpay subscriptions, which need
 * Subscriptions switched on for the Razorpay account first.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  if (ctx.role !== "owner" && ctx.role !== "admin") return fail("Only an owner or admin can pay for the workspace.", 403);
  if (!razorpayConfigured()) return fail("Card payments aren't switched on yet.", 503);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Say what you're buying.", 422);

  const [wp, user] = await Promise.all([
    workspacePlan(ctx.orgId),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
  ]);

  const notes: Record<string, string> = { organizationId: ctx.orgId, userId: ctx.userId, kind: parsed.data.kind };
  let amountCents: number;
  let description: string;
  let receipt: string;

  if (parsed.data.kind === "test_drive") {
    if (wp.access === "active" && wp.plan?.billing === "monthly") return fail(`You're already on ${wp.plan.name}.`, 409);
    if (wp.access === "active" && wp.plan?.id === "test_drive") {
      return fail(`Your Test Drive is already running, with ${wp.daysLeft} ${wp.daysLeft === 1 ? "day" : "days"} left.`, 409);
    }
    if (wp.access === "trial") return fail("You're on a free trial. Choose a monthly plan to keep going when it ends.", 409);
    const plan = PLANS.test_drive;
    amountCents = plan.price * 100;
    description = `${plan.name}: ${plan.days} days, ${plan.dailyCredits} credits a day`;
    receipt = `testdrive_${Date.now().toString(36)}`;
  } else {
    // Paid plans only: top-ups are lost when a plan ends, so selling them to a
    // trial that may never convert is a refund request waiting to happen.
    if (!wp.plan?.topUps || wp.access !== "active" || !canSpend(wp)) {
      return fail("Top-ups are for Start, Grow and Scale subscribers.", 402);
    }
    const packId = parsed.data.packId;
    const pack = TOP_UP_PACKS.find((p) => p.id === packId);
    if (!pack) return fail("No such pack.", 422);
    const purchase = await prisma.creditPurchase.create({
      data: { organizationId: ctx.orgId, packId: pack.id, credits: pack.credits, amountCents: pack.price * 100 },
    });
    amountCents = purchase.amountCents;
    description = `${pack.credits.toLocaleString("en-US")} credits`;
    receipt = `pack_${purchase.id}`;
    notes.purchaseId = purchase.id;
  }

  try {
    const order = await createOrder({ amountCents, receipt, notes });
    if (notes.purchaseId) {
      await prisma.creditPurchase.update({ where: { id: notes.purchaseId }, data: { razorpayOrderId: order.id } });
    }
    return ok({
      keyId: razorpayKeyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      description,
      prefill: { name: user?.name ?? "", email: user?.email ?? "" },
    });
  } catch (e) {
    if (notes.purchaseId) {
      await prisma.creditPurchase.update({ where: { id: notes.purchaseId }, data: { status: "failed" } }).catch(() => {});
    }
    console.error("[billing/checkout] order failed:", e);
    return fail(e instanceof RazorpayError ? `Razorpay couldn't start the payment: ${e.message}` : "Couldn't start the payment.", 502);
  }
}
