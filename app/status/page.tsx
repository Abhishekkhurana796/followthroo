import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";

export const metadata = { title: "Status — Followthroo" };

const SYSTEMS = [
  "API",
  "Dashboard",
  "Email sending",
  "LinkedIn automation",
  "WhatsApp (Twilio)",
  "AI agent",
  "Webhooks",
  "Job queue",
];

export default function StatusPage() {
  return (
    <SiteShell>
      <PageHero kicker="Status" title="All systems operational" subtitle="Live health of Followthroo services. Configured integrations show under /api/status in your own instance." />
      <section className="bg-canvas pb-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {SYSTEMS.map((s) => (
              <div key={s} className="flex items-center justify-between border-b border-line px-5 py-4 last:border-0">
                <span className="text-sm font-medium">{s}</span>
                <span className="flex items-center gap-2 text-sm text-ink-soft">
                  <span className="h-2.5 w-2.5 rounded-full bg-ink" />
                  Operational
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
