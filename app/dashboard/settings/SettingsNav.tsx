"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Users2, Mail, Linkedin, CreditCard, Bell, ArrowLeft, Webhook, Workflow, MessageCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/dashboard/settings/profile", icon: User, label: "Profile" },
  { href: "/dashboard/settings/team", icon: Users2, label: "Team" },
  { href: "/dashboard/settings/pipelines", icon: Workflow, label: "Pipelines" },
  { href: "/dashboard/settings/sources", icon: Webhook, label: "Lead sources" },
  { href: "/dashboard/accounts", icon: Mail, label: "Mailboxes & domains" },
  { href: "/dashboard/settings/channels", icon: MessageCircle, label: "Business channels" },
  { href: "/dashboard/settings/compliance", icon: ShieldCheck, label: "Compliance ledger" },
  { href: "/dashboard/settings/billing", icon: CreditCard, label: "Plans & billing" },
  { href: "/dashboard/settings/notifications", icon: Bell, label: "Notifications" },
];

/**
 * Sub-navigation for the settings section. Previously each sub-page was a
 * dead end — no layout, no trail, and browser-back was the only way out.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const onHub = pathname === "/dashboard/settings";
  if (onHub) return null;

  return (
    <aside className="shrink-0 border-b border-line px-4 py-4 lg:w-56 lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
      <Link
        href="/dashboard/settings"
        className="mb-3 flex items-center gap-1.5 px-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All settings
      </Link>
      <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent-soft font-semibold text-accent-strong"
                  : "text-ink-soft hover:bg-tint hover:text-ink",
              )}
            >
              <l.icon className={cn("h-4 w-4", active && "text-accent")} />
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
