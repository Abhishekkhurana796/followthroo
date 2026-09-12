import Link from "next/link";
import { Lock } from "lucide-react";
import type { Plan } from "@/lib/billing/plans";

/**
 * What a screen shows in its own place when the workspace's plan doesn't include
 * it: what it does, which plan has it, and the way there. Nothing behind it is
 * lost — it comes straight back on a plan that includes it.
 */
export function PlanUpsell({
  title,
  body,
  current,
  needed,
}: {
  title: string;
  body: string;
  current: Plan | null;
  needed: Plan;
}) {
  return (
    <div className="px-4 py-10 lg:px-8">
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{body}</p>
        <p className="mt-4 text-sm text-ink">
          {current ? `Your ${current.name} plan doesn't include it.` : "It needs a plan."} {needed.name} and above do, from $
          {needed.price} a month.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/pricing" className="btn btn-primary">
            See plans
          </Link>
          <Link href="/dashboard/settings/billing" className="btn btn-ghost">
            Plans &amp; billing
          </Link>
        </div>
      </div>
    </div>
  );
}
