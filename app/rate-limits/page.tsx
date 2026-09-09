import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { CTABand } from "@/components/site/blocks";

export const metadata = { title: "Rate limits — Followthroo" };

const LIMITS = [
  { channel: "Email (Gmail free)", start: "500 / day", ceiling: "—", note: "Paced ~40/hour; freezes ~24h on breach" },
  { channel: "Email (paid Workspace)", start: "2,000 / day", ceiling: "3,000 external", note: "SPF + DKIM strongly recommended" },
  { channel: "LinkedIn invites", start: "~20 / day", ceiling: "ramps weekly", note: "Increases with acceptance rate" },
  { channel: "WhatsApp", start: "250 / 24h", ceiling: "up to 100,000", note: "Tiers up after business verification" },
];

export default function RateLimitsPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Rate limits"
        title="The limits we respect — automatically"
        subtitle="Every send takes a token from a rolling window first. Hit a cap and the job queues for the next window instead of failing."
      />
      <section className="bg-canvas pb-8">
        <div className="mx-auto max-w-4xl px-6">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-tint font-mono text-xs uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Starting</th>
                  <th className="px-4 py-3">Ceiling</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {LIMITS.map((l) => (
                  <tr key={l.channel}>
                    <td className="px-4 py-3 font-medium">{l.channel}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{l.start}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{l.ceiling}</td>
                    <td className="px-4 py-3 text-ink-soft">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            Plus 30–90s of human-like jitter between actions, gradual account warm-up, and auto-pause when
            bounce or spam rates spike.
          </p>
        </div>
      </section>
      <CTABand />
    </SiteShell>
  );
}
