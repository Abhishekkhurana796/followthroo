import Link from "next/link";
import { Users2, Mail, CreditCard, Bell, ArrowRight, Linkedin, User, Webhook, Workflow, MessageCircle, ShieldCheck } from "lucide-react";
import { ReplayTourCard } from "@/components/dashboard/tour/ReplayTourButton";
import { DashHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/dashboard/settings/profile", icon: User, title: "Profile", desc: "Your name — signs your outreach emails." },
  { href: "/dashboard/settings/team", icon: Users2, title: "Team", desc: "Invite teammates, roles and department hierarchy." },
  { href: "/dashboard/settings/pipelines", icon: Workflow, title: "Pipelines", desc: "Stages and SLA timers, per department." },
  { href: "/dashboard/settings/sources", icon: Webhook, title: "Lead sources", desc: "Webhook URLs for Meta, IndiaMART, JustDial & web forms." },
  { href: "/dashboard/accounts", icon: Mail, title: "Mailboxes & domains", desc: "Buy a sending domain, or connect a mailbox you already have." },
  { href: "/dashboard/settings/channels", icon: MessageCircle, title: "Business channels", desc: "WhatsApp connection status; SMS setup requirements." },
  { href: "/dashboard/settings/compliance", icon: ShieldCheck, title: "Compliance ledger", desc: "Hash-chained audit trail of every consent/suppression event." },
  { href: "/dashboard/settings/billing", icon: CreditCard, title: "Plans & billing", desc: "Your current plan and what's included." },
  { href: "/dashboard/settings/notifications", icon: Bell, title: "Notifications", desc: "Choose what we email you about." },
];

export default function Page() {
  return (
    <>
      <DashHeader title="Settings" subtitle="Manage your workspace and account." />
      <div className="grid max-w-3xl gap-4 p-8 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group flex items-start gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:border-accent hover:shadow-md"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
              <c.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 font-display text-base font-bold">
                {c.title}
                <ArrowRight className="h-4 w-4 text-ink-soft/0 transition group-hover:text-accent" />
              </div>
              <p className="mt-0.5 text-sm text-ink-soft">{c.desc}</p>
            </div>
          </Link>
        ))}
        <ReplayTourCard />
      </div>
    </>
  );
}
