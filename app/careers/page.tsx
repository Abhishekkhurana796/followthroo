import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { CTABand } from "@/components/site/blocks";

export const metadata = { title: "Careers — Followthroo" };

const ROLES = [
  { title: "Senior Full-Stack Engineer", team: "Engineering", location: "Remote" },
  { title: "Deliverability Specialist", team: "Growth", location: "Remote" },
  { title: "Product Designer", team: "Design", location: "Remote" },
  { title: "Customer Success Lead", team: "Success", location: "Remote" },
];

export default function CareersPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Careers"
        title="Build the outreach tool you wish existed"
        subtitle="Small team, real ownership, remote-first. We care about craft and about not being spammy."
      />
      <section className="bg-canvas pb-16">
        <div className="mx-auto max-w-3xl px-6">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {ROLES.map((r) => (
              <li key={r.title} className="flex flex-wrap items-center justify-between gap-2 p-5">
                <div>
                  <div className="font-display text-lg font-bold">{r.title}</div>
                  <div className="font-mono text-xs text-ink-soft">{r.team} · {r.location}</div>
                </div>
                <Link href="/contact" className="btn btn-ghost !py-2 !text-sm">Apply</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <CTABand title="Don't see your role? Tell us anyway." cta="Get in touch" href="/contact" />
    </SiteShell>
  );
}
