"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Popover } from "@/components/ui";
import { SUMMARY_KEY, type Summary } from "@/components/dashboard/billing/types";
import { count, spendingPlan, until } from "@/components/dashboard/billing/format";

/**
 * Today's credits, at the foot of the rail: what's left of the day and the
 * top-up balance, and — opened — what the day's credits went on.
 *
 * It sits on the rail rather than being a row in it: it's a meter, not a
 * destination, and the destination (Billing) is one click away inside it.
 */
export function CreditsChip() {
  const { data } = useSWR<Summary>(SUMMARY_KEY, { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  if (!spendingPlan(data)) return null;

  const { allowance, left, topup, used, resetsAt, zone, spent } = data.credits;
  const share = allowance ? left / allowance : 0;
  const out = left === 0 && topup === 0;
  const low = !out && topup === 0 && share <= 0.15;
  const warn = out || low;
  const canBuy = data.plan.topUps;

  const status = out
    ? canBuy
      ? "Used up · Buy credits"
      : "Used up · back at midnight"
    : low
      ? canBuy
        ? "Running low · Buy credits"
        : "Running low · back at midnight"
      : topup
        ? `+${count(topup)} top-up · resets at midnight`
        : "Resets at midnight";

  return (
    <div className="shrink-0 px-3 pb-2">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="top-start"
        className="w-[288px]"
        trigger={
          <button
            type="button"
            aria-label={`Credits: ${left} of ${allowance} left today${topup ? `, plus ${topup} in top-ups` : ""}. Open the breakdown.`}
            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              warn ? "border-warning/40 bg-warning-soft" : "border-accent/30 bg-accent-soft/60 hover:bg-accent-soft"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${warn ? "text-warning-strong" : "text-accent-strong"}`}>
                Credits
              </span>
              <span className={`font-mono text-xs ${warn ? "text-warning-strong" : "text-ink"}`}>
                {count(left)} left of {count(allowance)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div
                className={`h-full rounded-full ${warn ? "bg-warning" : "bg-accent"}`}
                style={{ width: `${Math.max(out ? 0 : 4, Math.round(share * 100))}%` }}
              />
            </div>
            <div className={`mt-1.5 truncate text-xs ${warn ? "font-medium text-warning-strong" : "text-ink-soft"}`}>{status}</div>
          </button>
        }
      >
        <div className="px-2.5 py-2">
          <div className="font-display text-base font-bold">Today&apos;s credits</div>
          <div className="text-xs text-ink-soft">
            Resets at midnight {zone} · in {until(resetsAt)}
          </div>

          <dl className="mt-3 space-y-2 text-sm">
            {spent.length === 0 && <div className="text-ink-soft">Nothing spent yet today.</div>}
            {spent.map((s) => (
              <div key={s.action} className="flex items-baseline gap-2">
                <dt className="min-w-0 flex-1 truncate text-ink-soft">{s.label}</dt>
                <dd className="font-mono text-xs text-ink-faint">
                  {s.credits % s.count === 0 ? `${s.count} × ${s.credits / s.count}` : s.count}
                </dd>
                <dd className="w-12 text-right font-mono text-xs text-ink">{count(s.credits)}</dd>
              </div>
            ))}
          </dl>

          <div className="my-3 h-px bg-line" />
          <div className="flex items-baseline justify-between text-sm font-semibold">
            <span>Used today</span>
            <span className="font-mono text-xs">
              {count(used)} of {count(allowance)}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between text-sm">
            <span className="text-ink-soft">Top-up balance</span>
            <span className="font-mono text-xs">{count(topup)}</span>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            {canBuy
              ? "Top-up credits are used only after today's run out, and never expire while you're subscribed."
              : "Your credits come back every midnight. Paid plans get more a day, and can top up."}
          </p>

          <div className="mt-3 flex items-center gap-1">
            <Link
              href={canBuy ? "/dashboard/settings/billing#top-up" : "/pricing"}
              onClick={() => setOpen(false)}
              className="btn btn-primary !px-3.5 !py-2 text-sm"
            >
              {canBuy ? "Buy credits" : "See plans"}
            </Link>
            <Link
              href="/dashboard/settings/billing"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink"
            >
              Billing &amp; credits
            </Link>
          </div>
        </div>
      </Popover>
    </div>
  );
}
