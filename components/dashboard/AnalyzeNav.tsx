"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { BarChart3, ShieldCheck, AlertTriangle, Bell, Radio, Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { PLAN_ORDER, PLANS, type Feature } from "@/lib/billing/plans";
import { SUMMARY_KEY, type Summary } from "@/components/dashboard/billing/types";

/**
 * Sub-navigation for the analysis screens.
 *
 * These used to be five separate rows in the sidebar, which is how a rail grows
 * to eighteen items and stops being navigable. They're one level in now — but
 * they're siblings in the route tree, not children of /dashboard/reports, so a
 * shared layout can't cover them. Each page renders this instead, which keeps
 * the trail visible without inventing a route hierarchy that doesn't exist.
 *
 * A tab the workspace's plan doesn't include stays visible, marked with the
 * plan that has it: a report you can't find is one you never learn exists.
 */
const LINKS: { href: string; icon: LucideIcon; label: string; feature?: Feature }[] = [
  { href: "/dashboard/reports", icon: BarChart3, label: "Reports" },
  { href: "/dashboard/deliverability", icon: ShieldCheck, label: "Deliverability", feature: "deliverability" },
  { href: "/dashboard/ageing", icon: AlertTriangle, label: "Ageing", feature: "team_reports" },
  { href: "/dashboard/escalations", icon: Bell, label: "Escalations", feature: "escalations" },
  { href: "/dashboard/control-tower", icon: Radio, label: "Control tower", feature: "team_reports" },
];

const firstPlanWith = (feature: Feature) => PLAN_ORDER.map((id) => PLANS[id]).find((p) => p.features.includes(feature));

export function AnalyzeNav() {
  const pathname = usePathname();
  const { data } = useSWR<Summary>(SUMMARY_KEY);

  return (
    <nav aria-label="Analysis" className="flex gap-1 overflow-x-auto border-b border-line px-8 py-2">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        const locked = !!l.feature && !!data?.enforced && !(data.plan?.features ?? []).includes(l.feature);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
              active ? "bg-accent-soft font-semibold text-accent-strong" : "text-ink-soft hover:bg-tint hover:text-ink",
            )}
          >
            <l.icon className={cn("h-3.5 w-3.5", active && "text-accent")} />
            {l.label}
            {locked && l.feature && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-tint px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-faint">
                <Lock className="h-2.5 w-2.5" aria-hidden />
                {firstPlanWith(l.feature)?.name}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
