import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export function FeatureGrid({
  items,
}: {
  items: { icon?: LucideIcon; title: string; body: string }[];
}) {
  return (
    <section className="bg-canvas py-16">
      <div className="mx-auto grid max-w-6xl gap-4 px-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            {it.icon && (
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-ink-invert">
                <it.icon className="h-5 w-5" />
              </div>
            )}
            <h3 className="font-display mt-4 text-xl font-bold">{it.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CTABand({
  title = "Start reaching leads where they reply",
  cta = "Start free",
  href = "/dashboard",
}: {
  title?: string;
  cta?: string;
  href?: string;
}) {
  return (
    <section className="bg-canvas pb-24 pt-8">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-[32px] bg-ink px-8 py-16 text-center text-ink-invert sm:px-14">
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] grid-dots" style={{ filter: "invert(1)" }} />
          <div className="relative">
            <h2 className="font-display mx-auto max-w-2xl text-[clamp(1.8rem,4vw,3rem)] font-extrabold">{title}</h2>
            <div className="mt-8 flex justify-center">
              <Link href={href} className="btn btn-primary">
                {cta} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Simple long-form content wrapper (legal / company prose). */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-canvas pb-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="space-y-6 text-[15px] leading-relaxed text-ink-soft [&_h2]:font-display [&_h2]:text-ink [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-10 [&_h2]:mb-1 [&_a]:text-ink [&_a]:underline [&_strong]:text-ink">
          {children}
        </div>
      </div>
    </section>
  );
}
