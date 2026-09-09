import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";

export const metadata = { title: "Blog — Followthroo" };

const POSTS = [
  { title: "How to warm up a new sending domain", date: "Jun 2026", read: "6 min", tag: "Deliverability" },
  { title: "Why ~20 LinkedIn invites/day is the safe ceiling", date: "May 2026", read: "4 min", tag: "LinkedIn" },
  { title: "Personalization that doesn't read like a mail-merge", date: "May 2026", read: "5 min", tag: "Copy" },
  { title: "WhatsApp templates: opt-in, quality, and the 24h window", date: "Apr 2026", read: "7 min", tag: "WhatsApp" },
];

export default function BlogPage() {
  return (
    <SiteShell>
      <PageHero kicker="Blog" title="Notes on outreach that works" subtitle="Deliverability, sequencing, and staying human at scale." />
      <section className="bg-canvas pb-24">
        <div className="mx-auto grid max-w-5xl gap-4 px-6 sm:grid-cols-2">
          {POSTS.map((p) => (
            <article key={p.title} className="group rounded-2xl border border-line bg-surface p-6 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="font-mono text-xs uppercase tracking-widest text-ink-soft">{p.tag}</div>
              <h3 className="font-display mt-2 text-xl font-bold">{p.title}</h3>
              <div className="mt-4 font-mono text-xs text-ink-soft">{p.date} · {p.read} read</div>
            </article>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
