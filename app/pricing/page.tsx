import Link from "next/link";
import { Check } from "lucide-react";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { CTABand } from "@/components/site/blocks";
import FAQ from "@/components/marketing/FAQ";

export const metadata = {
  title: "Pricing — Followthroo",
  description: "Simple pricing that scales with your outreach — start free, upgrade when you add channels and volume. No card required to begin.",
  openGraph: {
    title: "Pricing — Followthroo",
    description: "Simple pricing that scales with your outreach — start free, upgrade when you add channels and volume. No card required to begin.",
    url: "https://followthroo.com/pricing",
  },
};

const TIERS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    blurb: "For trying it out on one channel.",
    features: ["1 sending account", "Email channel", "500 leads", "CSV import", "Community support"],
    cta: "Start free",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$49",
    period: "per user / month",
    blurb: "For teams running real multi-channel campaigns.",
    features: ["3 sending accounts", "Email + LinkedIn + WhatsApp", "10,000 leads", "Sequences & templates", "AI agent", "Priority support"],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    name: "Scale",
    price: "Custom",
    period: "let's talk",
    blurb: "For high-volume outreach and compliance needs.",
    features: ["Unlimited accounts", "All channels + social", "Unlimited leads", "SSO & roles", "Dedicated limits & warm-up", "SLA & onboarding"],
    cta: "Contact sales",
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Pricing"
        title="Simple pricing that scales with your outreach"
        subtitle="Start free. Upgrade when you add channels and volume. No card required to begin."
      />

      <section className="bg-canvas pb-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-[24px] border p-8 transition-all duration-200 ${
                t.highlighted
                  ? "border-accent bg-accent/5 shadow-xl ring-2 ring-accent/30"
                  : "border-line bg-surface shadow-sm"
              }`}
            >
              {t.highlighted && (
                <span className="absolute right-6 top-6 rounded-full bg-accent px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white">
                  Popular
                </span>
              )}
              <div className="font-mono text-xs uppercase tracking-widest text-accent font-semibold">{t.name}</div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-4xl font-extrabold">{t.price}</span>
                <span className="text-sm text-ink-soft">{t.period}</span>
              </div>
              <p className="mt-3 text-sm text-ink-soft">{t.blurb}</p>

              <ul className="mt-6 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${t.highlighted ? "text-accent" : "text-ink-soft"}`} />
                    <span className="text-ink">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={t.name === "Scale" ? "/contact" : "/dashboard"}
                className={`btn mt-8 justify-center ${t.highlighted ? "btn-primary" : "btn-ghost"}`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <FAQ />
      <CTABand title="Not sure which plan? Start free and grow into it." />
    </SiteShell>
  );
}
