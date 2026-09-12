/**
 * Razorpay, spoken directly over its REST API.
 *
 * No SDK: this needs orders, subscriptions, plans and three signature checks,
 * and each is one authenticated fetch or one HMAC. The keys are
 * RAZORPAY_API_KEY (the key id — rzp_test_… or rzp_live_…) and RAZORPAY_SECRET;
 * webhooks add RAZORPAY_WEBHOOK_SECRET. Test keys make test-mode objects, and
 * nothing here needs to know which it is.
 *
 * Amounts are in the currency's smallest unit — cents, for USD.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

export const razorpayConfigured = () => !!process.env.RAZORPAY_API_KEY && !!process.env.RAZORPAY_SECRET;

/** The key id Checkout needs in the browser. Public by design; the secret never leaves the server. */
export const razorpayKeyId = () => process.env.RAZORPAY_API_KEY ?? "";

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!razorpayConfigured()) throw new RazorpayError("Card payments aren't set up on this deployment.", 503);
  const auth = Buffer.from(`${process.env.RAZORPAY_API_KEY}:${process.env.RAZORPAY_SECRET}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string; code?: string } };
  if (!res.ok) throw new RazorpayError(json.error?.description ?? `Razorpay answered ${res.status}`, res.status, json.error?.code);
  return json as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
  notes?: Record<string, string>;
}

/** A one-time charge: the Test Drive, or a top-up pack. */
export const createOrder = (input: { amountCents: number; receipt: string; notes: Record<string, string>; currency?: string }) =>
  call<RazorpayOrder>("POST", "/orders", {
    amount: input.amountCents,
    currency: input.currency ?? "USD",
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
  });

export const fetchOrder = (id: string) => call<RazorpayOrder>("GET", `/orders/${encodeURIComponent(id)}`);

export interface RazorpayPlan {
  id: string;
  period: string;
  interval: number;
  item: { name: string; amount: number; currency: string };
  notes?: Record<string, string>;
}

export const listPlans = () => call<{ items: RazorpayPlan[] }>("GET", "/plans?count=100");

export const createPlan = (input: { name: string; amountCents: number; notes: Record<string, string>; currency?: string }) =>
  call<RazorpayPlan>("POST", "/plans", {
    period: "monthly",
    interval: 1,
    item: { name: input.name, amount: input.amountCents, currency: input.currency ?? "USD" },
    notes: input.notes,
  });

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  customer_id?: string | null;
  notes?: Record<string, string>;
  short_url?: string;
}

/** A monthly plan. `total_count` is how many cycles before Razorpay stops billing: ten years. */
export const createSubscription = (input: { planId: string; notes: Record<string, string> }) =>
  call<RazorpaySubscription>("POST", "/subscriptions", {
    plan_id: input.planId,
    total_count: 120,
    customer_notify: 1,
    notes: input.notes,
  });

export const fetchSubscription = (id: string) => call<RazorpaySubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);

export const cancelSubscription = (id: string, atCycleEnd = true) =>
  call<RazorpaySubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });

const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest("hex");

function sameHex(expected: string, given: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout's proof an order was paid: HMAC-SHA256 of `order_id|payment_id` with the key secret. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  return sameHex(hmac(process.env.RAZORPAY_SECRET ?? "", `${orderId}|${paymentId}`), signature);
}

/** …and that a subscription's first payment went through: HMAC-SHA256 of `payment_id|subscription_id`. */
export function verifySubscriptionSignature(subscriptionId: string, paymentId: string, signature: string) {
  return sameHex(hmac(process.env.RAZORPAY_SECRET ?? "", `${paymentId}|${subscriptionId}`), signature);
}

/** A webhook's X-Razorpay-Signature: HMAC-SHA256 of the raw body with the webhook secret. False with no secret set. */
export function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  return !!secret && sameHex(hmac(secret, rawBody), signature);
}
