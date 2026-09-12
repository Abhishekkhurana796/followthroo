"use client";

import Link from "next/link";
import useSWR from "swr";
import { SUMMARY_KEY, type Summary } from "@/components/dashboard/billing/types";

type Tone = "danger" | "warning" | "info";

const BOX: Record<Tone, string> = {
  danger: "border-danger/30 bg-danger-soft",
  warning: "border-warning/40 bg-warning-soft",
  info: "border-accent/20 bg-accent-soft/60",
};
const TITLE: Record<Tone, string> = {
  danger: "text-danger-strong",
  warning: "text-warning-strong",
  info: "text-ink",
};

/**
 * The one billing message that matters right now, above every dashboard page:
 * there's no plan or it has ended, today's credits are used up, or a trial is
 * counting down. One at a time, most urgent first — three stacked banners are
 * three banners nobody reads.
 *
 * Nothing shows until billing is enforced.
 */
export function BillingBanner() {
  const { data } = useSWR<Summary>(SUMMARY_KEY, { refreshInterval: 60_000 });
  if (!data?.enforced) return null;
  const plan = data.plan;

  let tone: Tone;
  let title: string;
  let body: string;
  let action: { label: string; href: string };

  if (data.access === "none" || data.access === "expired") {
    tone = "danger";
    if (data.access === "none") {
      title = "Choose a plan to start sending";
      body = "Your leads, inbox and CRM are ready. Sending, enrichment and posting start once you pick a plan — or try it on your own leads for $2.";
    } else {
      title =
        data.status === "trialing" ? "Your trial has ended" : plan?.billing === "one_time" ? `Your ${plan.name} has ended` : "Your plan has ended";
      body = "Sending, enrichment and posting are paused. Everything you added is still here — choose a plan to pick up where you left off.";
    }
    action = { label: "Choose a plan", href: "/pricing" };
  } else if (data.credits.left === 0 && data.credits.topup === 0) {
    tone = "warning";
    title = "Today's credits are used up";
    body = "Campaign steps are paused and nothing is lost. They carry on at midnight.";
    action = plan?.topUps
      ? { label: "Buy credits", href: "/dashboard/settings/billing#top-up" }
      : { label: "See plans", href: "/pricing" };
  } else if (data.access === "trial" && plan) {
    const days = data.daysLeft ?? 14;
    tone = "info";
    title = `${plan.name} trial · ${days} ${days === 1 ? "day" : "days"} left`;
    body = "After that, sending, enrichment and posting pause until you choose a plan. Your leads and conversations stay.";
    action = { label: "Choose a plan", href: "/pricing" };
  } else {
    return null;
  }

  return (
    <div className="px-4 pt-4 lg:px-8">
      <div
        role={tone === "info" ? "status" : "alert"}
        className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border px-5 py-3.5 ${BOX[tone]}`}
      >
        <div className="min-w-0 flex-1 basis-64">
          <div className={`text-sm font-semibold ${TITLE[tone]}`}>{title}</div>
          <p className={`text-sm ${tone === "info" ? "text-ink-soft" : TITLE[tone]}`}>{body}</p>
        </div>
        <Link href={action.href} className="btn btn-primary shrink-0 !px-4 !py-2 text-sm">
          {action.label}
        </Link>
      </div>
    </div>
  );
}
