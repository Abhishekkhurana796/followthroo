import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { Mail, MessageCircle, Building2 } from "lucide-react";

export const metadata = { title: "Contact — Followthroo" };

export default function ContactPage() {
  return (
    <SiteShell>
      <PageHero kicker="Contact" title="Talk to us" subtitle="Sales questions, support, or just curious — we reply fast." />
      <section className="bg-canvas pb-16">
        <div className="mx-auto grid max-w-5xl gap-4 px-6 sm:grid-cols-3">
          {[
            { icon: Mail, title: "Email", detail: "hello@followthroo.com" },
            { icon: MessageCircle, title: "Support", detail: "support@followthroo.com" },
            { icon: Building2, title: "Sales", detail: "Book a 20-min demo" },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-line bg-surface p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-ink-invert">
                <c.icon className="h-5 w-5" />
              </div>
              <div className="font-display mt-4 text-lg font-bold">{c.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{c.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-canvas pb-24">
        <form className="mx-auto max-w-xl space-y-4 px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <input className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-ink" placeholder="Name" />
            <input className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-ink" placeholder="Work email" type="email" />
          </div>
          <textarea className="min-h-32 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-ink" placeholder="How can we help?" />
          <button type="submit" className="btn btn-primary w-full justify-center">Send message</button>
        </form>
      </section>
    </SiteShell>
  );
}
