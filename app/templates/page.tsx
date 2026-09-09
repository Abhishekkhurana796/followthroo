import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { FeatureGrid, CTABand } from "@/components/site/blocks";
import { Braces, Eye, ShieldAlert } from "lucide-react";

export const metadata = { title: "Templates — Followthroo" };

export default function TemplatesPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Templates"
        title="Write once, personalize for thousands"
        subtitle="Handlebars-style variables with fallbacks keep every message personal — and never leave an awkward empty {{firstName}}."
      />
      <section className="bg-canvas pb-4">
        <div className="mx-auto max-w-3xl px-6">
          <pre className="overflow-x-auto rounded-2xl bg-ink p-6 font-mono text-sm text-ink-invert/90">{`Hi {{firstName|there}}, I noticed {{company}} is
scaling {{team|your team}} — thought this might help.`}</pre>
        </div>
      </section>
      <FeatureGrid
        items={[
          { icon: Braces, title: "CSV variables", body: "Any column in your import becomes a variable. No setup — unknown fields map automatically." },
          { icon: ShieldAlert, title: "Fallbacks", body: "The {{firstName|there}} syntax swaps in a safe default whenever a value is missing." },
          { icon: Eye, title: "Preview & test", body: "Render with sample data and send a test to yourself before a single lead is contacted." },
        ]}
      />
      <CTABand />
    </SiteShell>
  );
}
