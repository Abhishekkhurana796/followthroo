import Link from "next/link";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";

/** The "Konnect" mark. */
function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden>
      <line x1="7" y1="13" x2="19" y2="13" stroke="var(--color-action)" strokeWidth="2.4" />
      <circle cx="7" cy="13" r="5" fill="var(--color-brand)" />
      <circle cx="19" cy="13" r="5" fill="var(--color-canvas)" stroke="var(--color-brand)" strokeWidth="2.4" />
    </svg>
  );
}

const BRANDSTAC_URL = "https://brandstac.com";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Channels", href: "/channels" },
      { label: "Sequences", href: "/sequences" },
      { label: "Templates", href: "/templates" },
      { label: "AI Agent", href: "/ai-agent" },
      { label: "CRM", href: "/crm" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "API", href: "/api-reference" },
      { label: "Rate limits", href: "/rate-limits" },
      { label: "Status", href: "/status" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "GDPR", href: "/gdpr" },
      { label: "Security", href: "/security" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-line bg-canvas py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
              <Mark /> Followthroo
            </Link>
            <p className="mt-4 max-w-xs text-sm text-ink-soft">
              Personalized outreach across every channel — sequenced, throttled, and human.
            </p>
            <p className="mt-4 text-sm text-ink-soft">
              A product by{" "}
              <a
                href={BRANDSTAC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-ink underline-offset-4 hover:underline"
              >
                brandstac
              </a>
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="font-mono text-xs uppercase tracking-widest text-ink-soft">{col.title}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-ink-soft transition-colors hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-line pt-6 text-xs text-ink-soft sm:flex-row">
          <span>© {new Date().getFullYear()} Followthroo. All rights reserved.</span>
          {/* The public site had no way to change theme at all: the provider was
              mounted inside the dashboard shell, so a visitor who prefers dark
              got whatever their system said and could not say otherwise. */}
          <ThemeToggle />
          <span className="font-mono">
            Built by{" "}
            <a
              href={BRANDSTAC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-ink"
            >
              brandstac
            </a>{" "}
            — New Delhi
          </span>
        </div>
      </div>
    </footer>
  );
}
