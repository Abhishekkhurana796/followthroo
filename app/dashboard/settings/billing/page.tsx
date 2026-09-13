"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { mutate as refresh } from "swr";
import { Badge, DashHeader, Panel, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { SUMMARY_KEY, type HistoryPage, type Summary } from "@/components/dashboard/billing/types";
import { count, spendingPlan, until } from "@/components/dashboard/billing/format";
import { KeepActiveDialog } from "@/components/dashboard/billing/KeepActiveDialog";
import { PLAN_ORDER, PLANS, TOP_UP_PACKS, packCreditRate, packVsPlan, planById, planCreditRate, type Plan } from "@/lib/billing/plans";

const HISTORY_KEY = "/api/billing/history";

const LIMIT_LABELS: Record<string, string> = {
  users: "People",
  inboxes: "Sending inboxes",
  campaigns: "Campaigns",
  templates: "Templates",
  leads: "Leads stored",
};

/** Razorpay Checkout's global, once its script has loaded. */
type RazorpayCheckout = {
  open: () => void;
  on: (event: string, cb: (response: { error?: { description?: string } }) => void) => void;
};
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

/** Load Checkout only when somebody pays — every other visit to Billing goes without it. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Razorpay Checkout. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

type Order = {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  prefill: { name: string; email: string };
};
type Purchase = { kind: "test_drive" } | { kind: "pack"; packId: string } | { kind: "plan"; planId: string };

/**
 * Pay through Razorpay Checkout. The server creates the order, Checkout takes the
 * payment in its own window, and the server checks Razorpay's signature before
 * granting anything. Closing Checkout without paying changes nothing.
 */
function usePayment(onPaid: (message: string) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(key: string, purchase: Purchase) {
    setBusy(key);
    setError(null);
    try {
      const [order] = await Promise.all([api<Order>("/api/billing/checkout", { body: purchase }), loadCheckout()]);
      const Checkout = window.Razorpay;
      if (!Checkout) throw new Error("Razorpay Checkout didn't load.");
      await new Promise<void>((resolve, reject) => {
        const checkout = new Checkout({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: "Followthroo",
          description: order.description,
          prefill: order.prefill,
          handler: (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
            api("/api/billing/verify", {
              body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature },
            })
              .then(() => {
                onPaid(
                  purchase.kind === "pack"
                    ? "Credits added — they're ready to use."
                    : purchase.kind === "plan"
                      ? "Your plan is live — today's credits are ready to use."
                      : "Your Test Drive has started.",
                );
                resolve();
              })
              .catch(reject);
          },
          modal: { ondismiss: () => resolve() },
        });
        checkout.on("payment.failed", (r) => reject(new Error(r.error?.description ?? "The payment didn't go through.")));
        checkout.open();
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return { pay, busy, error };
}
type Payment = ReturnType<typeof usePayment>;

/**
 * Plans & billing: the plan and how much of it is used, today's credits, the
 * Test Drive and top-ups, and every charge and refund.
 *
 * Every number comes from lib/billing — plans.ts for prices and limits, the
 * ledger for credits — so this page can't disagree with what's charged.
 * One-time payments (the Test Drive, packs) go through Razorpay Checkout; monthly
 * plans are set up by hand until Razorpay Subscriptions is switched on.
 */
export default function Page() {
  const { data } = useSWR<Summary>(SUMMARY_KEY, { refreshInterval: 60_000 });
  const toast = useToast();
  const [keepOpen, setKeepOpen] = useState(false);
  const payment = usePayment((message) => {
    toast(message, "success");
    void refresh(SUMMARY_KEY);
    void refresh(HISTORY_KEY);
  });

  // The banner's "Choose what stays active" lands here with ?keep=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("keep") === "1") setKeepOpen(true);
  }, []);

  return (
    <>
      <DashHeader
        title="Plans & billing"
        subtitle={data ? subtitleFor(data) : undefined}
        breadcrumb={
          <div className="mb-1 text-xs text-ink-soft">
            <Link href="/dashboard/settings" className="hover:text-ink">
              Settings
            </Link>{" "}
            / Plans &amp; billing
          </div>
        }
      />
      <div className="max-w-5xl space-y-10 px-4 py-6 lg:p-8">
        {!data ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        ) : (
          <>
            <TestDrive data={data} payment={payment} />
            <div className="grid gap-5 lg:grid-cols-2">
              <YourPlan data={data} onKeepActive={() => setKeepOpen(true)} />
              <TodaysCredits data={data} />
            </div>
            <PlanPicker data={data} payment={payment} />
            <TopUps data={data} payment={payment} />
            <AutoRecharge />
            <History />
          </>
        )}
      </div>
      <KeepActiveDialog
        open={keepOpen}
        onClose={() => setKeepOpen(false)}
        onDone={() => {
          setKeepOpen(false);
          toast("Saved. Anything left out is paused, not deleted.", "success");
          void refresh(SUMMARY_KEY);
        }}
      />
    </>
  );
}

function subtitleFor(data: Summary) {
  const plan = data.plan;
  if (!plan) return "No plan yet.";
  if (data.access === "expired") return `${plan.name} has ended.`;
  if (data.access === "trial") return `${plan.name} trial · ${data.daysLeft ?? 14} days left`;
  if (plan.billing === "one_time") return `${plan.name} · ${data.daysLeft ?? 0} days left`;
  return `${plan.name} · $${plan.price} a month`;
}

/** The next plan up that has more room for this limit. */
function roomierPlan(current: string | undefined, key: string, used: number): Plan | null {
  const from = PLAN_ORDER.indexOf((current ?? "test_drive") as Plan["id"]);
  for (const id of PLAN_ORDER.slice(from + 1)) {
    const limit = PLANS[id].limits[key as keyof Plan["limits"]];
    if (limit === null || limit > used) return PLANS[id];
  }
  return null;
}

function Bar({ share, tone = "accent" }: { share: number; tone?: "accent" | "warning" }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
      <div
        className={`h-full rounded-full ${tone === "warning" ? "bg-warning" : "bg-accent"}`}
        style={{ width: `${Math.min(100, Math.max(0, Math.round(share * 100)))}%` }}
      />
    </div>
  );
}

function TestDrive({ data, payment }: { data: Summary; payment: Payment }) {
  const plan = PLANS.test_drive;
  if (!data.enforced || !(data.access === "none" || data.access === "expired")) return null;
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-4 !border-accent/40">
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-base font-bold">Test Drive</h2>
          <Badge tone="accent">${plan.price} once</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {plan.days} days on your own leads with {plan.dailyCredits} credits a day — about 10 LinkedIn invitations or 30 emails, every
          day. It isn&apos;t a subscription: it simply ends.
        </p>
        {payment.error && payment.busy === null && <p className="mt-2 text-sm text-danger">{payment.error}</p>}
      </div>
      {data.payments ? (
        <button
          type="button"
          onClick={() => payment.pay("test_drive", { kind: "test_drive" })}
          disabled={payment.busy !== null}
          className="btn btn-primary shrink-0 !px-4 !py-2 text-sm disabled:opacity-60"
        >
          {payment.busy === "test_drive" ? "Opening…" : `Start for $${plan.price}`}
        </button>
      ) : (
        <Link href="/contact" className="btn btn-ghost shrink-0 !px-4 !py-2 text-sm">
          Message us to start
        </Link>
      )}
    </Panel>
  );
}

function YourPlan({ data, onKeepActive }: { data: Summary; onKeepActive: () => void }) {
  const plan = data.plan;
  const priceLine = !plan
    ? "Pick a plan to start sending. Your leads and conversations are safe either way."
    : data.access === "trial"
      ? `Free for ${data.daysLeft ?? 14} more ${data.daysLeft === 1 ? "day" : "days"}, then $${plan.price} a month if you choose it.`
      : plan.billing === "one_time"
        ? `$${plan.price} once · ${data.access === "expired" ? "ended" : `${data.daysLeft ?? 0} days left`}`
        : `$${plan.price} a month`;
  const over = data.enforced && data.limits.some((l) => l.limit !== null && l.used > l.limit);

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <h2 className="font-display text-base font-bold">Your plan</h2>
        {plan && <Badge tone="accent">{data.access === "trial" ? `${plan.name} trial` : plan.name}</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-soft">{priceLine}</p>

      {plan && (
        <ul className="mt-5 space-y-4">
          {data.limits.map((l) => {
            const full = l.limit !== null && l.used >= l.limit;
            const overBy = l.limit !== null && l.used > l.limit ? l.used - l.limit : 0;
            const next = full ? roomierPlan(plan.id, l.key, l.used) : null;
            const nextRoom = next ? next.limits[l.key as keyof Plan["limits"]] : null;
            return (
              <li key={l.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold">{LIMIT_LABELS[l.key] ?? l.key}</span>
                  <span className={`font-mono text-xs ${full ? "text-warning-strong" : "text-ink-soft"}`}>
                    {count(l.used)} of {l.limit === null ? "unlimited" : count(l.limit)}
                  </span>
                </div>
                <Bar share={l.limit === null ? 0.1 : l.limit ? l.used / l.limit : 1} tone={full ? "warning" : "accent"} />
                {full && (
                  <p className="mt-1 text-xs text-warning-strong">
                    {overBy ? `Over by ${count(overBy)}. Nothing is deleted, and nothing new can be added.` : "Full."}{" "}
                    {next && `${next.name} has room for ${nextRoom === null ? "unlimited" : count(nextRoom)}.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <a href="#choose-plan" className="btn btn-ghost !px-4 !py-2 text-sm">
          {plan?.billing === "monthly" ? "Change plan" : "Choose a plan"}
        </a>
        {over && (
          <button type="button" onClick={onKeepActive} className="btn btn-primary !px-4 !py-2 text-sm">
            Choose what stays active
          </button>
        )}
      </div>
      {!data.payments && (
        <p className="mt-3 text-xs text-ink-soft">
          Card payments are being switched on —{" "}
          <Link href="/contact" className="font-semibold text-accent-strong hover:underline">
            message us
          </Link>{" "}
          and we&apos;ll set your plan by hand until then.
        </p>
      )}
    </Panel>
  );
}

function PlanPicker({ data, payment }: { data: Summary; payment: Payment }) {
  const monthly = PLAN_ORDER.map((id) => PLANS[id]).filter((p) => p.billing === "monthly");
  const current = data.plan?.billing === "monthly" ? data.plan.id : null;

  return (
    <section id="choose-plan" className="scroll-mt-6">
      <h2 className="font-display text-lg font-bold">{current ? "Change plan" : "Choose a plan"}</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        Every plan includes the CRM, the inbox and every channel — they differ in daily credits, seats and limits.
        Switching takes effect immediately.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {monthly.map((plan) => {
          const isCurrent = current === plan.id;
          const featured = plan.id === "grow" && !isCurrent;
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border bg-surface p-5 ${featured ? "border-accent ring-1 ring-accent/40" : "border-line"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-bold">{plan.name}</span>
                {isCurrent && <Badge tone="accent">Current plan</Badge>}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-display text-3xl font-extrabold">${plan.price}</span>
                <span className="text-sm text-ink-soft">/mo</span>
              </div>
              <p className="mt-2 flex-1 text-xs text-ink-soft">{plan.blurb}</p>
              <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                <li>{count(plan.dailyCredits)} credits a day</li>
                <li>
                  {count(plan.limits.users)} {plan.limits.users === 1 ? "user" : "users"} · {count(plan.limits.inboxes)}{" "}
                  {plan.limits.inboxes === 1 ? "inbox" : "inboxes"}
                </li>
                <li>{plan.limits.leads === null ? "Unlimited leads" : `${count(plan.limits.leads)} leads stored`}</li>
              </ul>
              <button
                type="button"
                disabled={isCurrent || !data.payments || payment.busy !== null}
                title={!data.payments ? "Card payments are being switched on" : undefined}
                onClick={() => payment.pay(plan.id, { kind: "plan", planId: plan.id })}
                className={`mt-4 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 ${featured ? "btn btn-primary" : "btn btn-ghost"}`}
              >
                {isCurrent ? "Current plan" : payment.busy === plan.id ? "Opening…" : `Subscribe for $${plan.price}/mo`}
              </button>
            </div>
          );
        })}
      </div>
      {payment.error && payment.busy === null && <p className="mt-3 text-sm text-danger">{payment.error}</p>}
      <p className="mt-3 text-xs text-ink-soft">
        {!data.payments ? (
          <>
            Card payments are being switched on. Until then,{" "}
            <Link href="/contact" className="font-semibold text-accent-strong hover:underline">
              message us
            </Link>{" "}
            and we&apos;ll set your plan by hand.
          </>
        ) : (
          "Paid through Razorpay, one month at a time for now — you'll get a reminder before it runs out. Card-on-file auto-renewal is coming."
        )}
      </p>
    </section>
  );
}

function TodaysCredits({ data }: { data: Summary }) {
  const live = spendingPlan(data);
  const { allowance, left, topup, resetsAt, zone } = data.credits;
  const share = allowance ? left / allowance : 0;
  const low = live && topup === 0 && share <= 0.15;

  return (
    <Panel>
      <h2 className="font-display text-base font-bold">Today&apos;s credits</h2>
      {live ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-5xl font-extrabold">{count(left)}</span>
            <span className="text-sm text-ink-soft">of {count(allowance)} left today</span>
          </div>
          <Bar share={share} tone={low ? "warning" : "accent"} />
          <p className="mt-3 text-xs text-ink-soft">
            Resets at midnight {zone} · in {until(resetsAt)}. Unused credits don&apos;t carry over.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">
          {data.enforced
            ? "No credits today — there's no plan running. Choose one and they start straight away."
            : "Credits start when plans do. Until then, nothing you send is counted."}
        </p>
      )}

      <div className="my-5 h-px bg-line" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Top-up balance</span>
        <span className="font-mono text-sm">{count(topup)} credits</span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">Used only after today&apos;s credits run out. Never expires while you&apos;re subscribed.</p>

      <div className="mt-5 flex flex-wrap items-center gap-1">
        {data.plan?.topUps && data.access === "active" && (
          <a href="#top-up" className="btn btn-primary !px-4 !py-2 text-sm">
            Buy credits
          </a>
        )}
        <Link
          href="/pricing#credits"
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink"
        >
          What costs what
        </Link>
      </div>
    </Panel>
  );
}

function TopUps({ data, payment }: { data: Summary; payment: Payment }) {
  const plan = planById(data.plan?.id);
  const monthly = plan?.billing === "monthly" ? plan : null;
  const next = monthly ? PLANS[PLAN_ORDER[PLAN_ORDER.indexOf(monthly.id) + 1]] : undefined;
  const canBuy = data.payments && !!monthly && data.access === "active" && spendingPlan(data);

  return (
    <section id="top-up" className="scroll-mt-6">
      <h2 className="font-display text-lg font-bold">Top up</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        {monthly
          ? `For the odd busy day. ${monthly.name}'s own credits cost $${planCreditRate(monthly).toFixed(4)} each; packs cost more than that.${
              next ? ` If you top up most weeks, ${next.name} works out cheaper and adds seats.` : ""
            }`
          : "Top-ups are for the paid plans — Start, Grow and Scale — for the odd busy day. They cost about 3× a plan's own credits."}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOP_UP_PACKS.map((pack, i) => {
          const best = i === TOP_UP_PACKS.length - 1;
          return (
            <div
              key={pack.id}
              className={`flex flex-col rounded-2xl border bg-surface p-5 ${best ? "border-accent ring-1 ring-accent/40" : "border-line"}`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-3xl font-extrabold">{count(pack.credits)}</span>
                <span className="text-sm text-ink-soft">credits</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">${pack.price}</span>
                <span className="font-mono text-xs text-ink-soft">
                  ${packCreditRate(pack).toFixed(3)} each{monthly ? ` · ${packVsPlan(pack, monthly)}× your plan` : ""}
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs text-ink-soft">
                ≈ {count(Math.floor(pack.credits / 3))} invitations, or {count(pack.credits)} emails
              </p>
              {best && (
                <Badge tone="accent" className="mt-3 self-start">
                  Lowest per credit
                </Badge>
              )}
              <button
                type="button"
                disabled={!canBuy || payment.busy !== null}
                title={!data.payments ? "Card payments are being switched on" : !canBuy ? "Top-ups are for Start, Grow and Scale subscribers" : undefined}
                onClick={() => payment.pay(pack.id, { kind: "pack", packId: pack.id })}
                className={`mt-4 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 ${best ? "btn btn-primary" : "btn btn-ghost"}`}
              >
                {payment.busy === pack.id ? "Opening…" : `Buy for $${pack.price}`}
              </button>
            </div>
          );
        })}
      </div>
      {payment.error && payment.busy === null && <p className="mt-3 text-sm text-danger">{payment.error}</p>}
      <p className="mt-3 text-xs text-ink-soft">
        {!data.payments ? (
          <>
            Card payments are being switched on. Until then,{" "}
            <Link href="/contact" className="font-semibold text-accent-strong hover:underline">
              message us
            </Link>{" "}
            and we&apos;ll add credits or change your plan by hand.
          </>
        ) : canBuy ? (
          "Paid through Razorpay. Credits land the moment the payment clears, and any campaign steps waiting for credits carry on straight away."
        ) : (
          "Top-ups are for Start, Grow and Scale subscribers."
        )}
      </p>
    </section>
  );
}

function AutoRecharge() {
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-bold">Auto-recharge</h2>
        <Badge>Coming soon</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Buy a pack on its own when credits run low, so campaigns don&apos;t pause — against a card you approve once, with a monthly
        ceiling you set.
      </p>
    </Panel>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return `Today ${time}`;
  if (day === today - 86_400_000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

function History() {
  const { data, isLoading } = useSWR<HistoryPage>(HISTORY_KEY, { refreshInterval: 60_000 });
  const [older, setOlder] = useState<HistoryPage["entries"]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = cursor === undefined ? (data?.next ?? null) : cursor;
  const entries = [...(data?.entries ?? []), ...older];

  async function loadMore() {
    if (!next) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<HistoryPage>(`${HISTORY_KEY}?before=${encodeURIComponent(next)}`);
      setOlder((rows) => [...rows, ...page.entries]);
      setCursor(page.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg font-bold">Credit history</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Every charge and refund, newest first. Credits are taken when something actually goes out.
      </p>

      <div className="relative mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line bg-tint text-left font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
              <th scope="col" className="px-4 py-3 font-medium">
                When
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                What
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Credits
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="px-4 py-4">
                  <Skeleton className="h-16 rounded-xl" />
                </td>
              </tr>
            )}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-ink-soft">
                  Nothing yet. Charges, refunds and top-ups show up here as they happen.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-b-0">
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-xs text-ink-soft">{when(e.at)}</td>
                <td className="px-4 py-3 align-top">
                  <div className="font-semibold text-ink">{e.label}</div>
                  {e.detail && <div className="text-xs text-ink-soft">{e.detail}</div>}
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right align-top font-mono ${
                    e.pending ? "text-ink-soft" : e.credits > 0 ? "text-success-strong" : e.credits === 0 ? "text-ink-faint" : "text-ink"
                  }`}
                >
                  {e.pending && <Badge className="mr-2">Held</Badge>}
                  {e.credits > 0 ? `+${count(e.credits)}` : count(e.credits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {next && (
        <button type="button" onClick={loadMore} disabled={loading} className="btn btn-ghost mt-4 !px-4 !py-2 text-sm disabled:opacity-60">
          {loading ? "Loading…" : "Show older"}
        </button>
      )}
    </section>
  );
}
