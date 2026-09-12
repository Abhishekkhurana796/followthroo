import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { fetchOrder, verifyPaymentSignature } from "@/lib/billing/razorpay";
import { grantOrder } from "@/lib/billing/payments";

export const runtime = "nodejs";

const Body = z.object({
  orderId: z.string().min(1).max(64),
  paymentId: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
});

/**
 * POST /api/billing/verify — Checkout says a payment went through. Prove it,
 * then grant what was bought.
 *
 * The signature proves Razorpay took this payment against this order. What the
 * order was for, and for which workspace, comes from the order itself, fetched
 * from Razorpay — never from the request. Verifying the same payment twice
 * grants once.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Missing payment details.", 422);
  const { orderId, paymentId, signature } = parsed.data;
  if (!verifyPaymentSignature(orderId, paymentId, signature)) return fail("That payment couldn't be verified.", 400);

  const order = await fetchOrder(orderId).catch(() => null);
  if (!order) return fail("Razorpay didn't recognise that order.", 502);
  if (order.notes?.organizationId !== ctx.orgId) return fail("That payment isn't for this workspace.", 403);

  try {
    return ok(await grantOrder(order, paymentId));
  } catch (e) {
    console.error("[billing/verify] grant failed:", e);
    return fail("The payment went through, but we couldn't apply it. It hasn't been lost — contact us and we'll sort it out.", 500);
  }
}
