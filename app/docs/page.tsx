import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { Boxes, Waypoints, Braces, Bot, Database, Gauge, TerminalSquare, Activity } from "lucide-react";

export const metadata = { title: "Docs — Followthroo" };

const LINKS = [
  { icon: Boxes, title: "Channels", href: "/channels", body: "Email, LinkedIn, WhatsApp, and social." },
  { icon: Waypoints, title: "Sequences", href: "/sequences", body: "Multi-step, reply-aware flows." },
  { icon: Braces, title: "Templates", href: "/templates", body: "Variables and fallbacks." },
  { icon: Bot, title: "AI Agent", href: "/ai-agent", body: "Let Claude run the campaign." },
  { icon: Database, title: "CRM", href: "/crm", body: "Leads, stages, and activity." },
  { icon: Gauge, title: "Rate limits", href: "/rate-limits", body: "Every quota, in one table." },
  { icon: TerminalSquare, title: "API reference", href: "/api-reference", body: "Endpoints and examples." },
  { icon: Activity, title: "Status", href: "/status", body: "Live integration health." },
];

export default function DocsPage() {
  return (
    <SiteShell>
      <PageHero kicker="Docs" title="Everything you need to ship outreach" subtitle="Guides for each part of Followthroo. Start with a channel, then wire a sequence." />
      <section className="bg-canvas pb-24">
        <div className="mx-auto grid max-w-6xl gap-4 px-6 sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map((l) => (
            <Link key={l.title} href={l.href} className="group rounded-2xl border border-line bg-surface p-6 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <l.icon className="h-6 w-6 text-ink" />
              <div className="font-display mt-4 text-lg font-bold">{l.title}</div>
              <p className="mt-1 text-sm text-ink-soft">{l.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
