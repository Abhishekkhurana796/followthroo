import Link from "next/link";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import Mark from "@/components/site/Mark";

const BRANDSTAC_URL = "https://brandstac.com";

/**
 * Structure lifted from lemlist.com's real footer (5 link columns, a small
 * circular mark straddling the top divider, a dark rounded bottom bar) —
 * confirmed live via Playwright, not guessed. Content is entirely ours:
 * every link below is a real Followthroo page, nothing padded to match
 * lemlist's column depth artificially.
 */
const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Get started",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Log in", href: "/sign-in" },
      { label: "Sign up", href: "/sign-up" },
      { label: "Get a demo", href: "/contact" },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "Channels", href: "/channels" },
      { label: "Sequences", href: "/sequences" },
      { label: "Templates", href: "/templates" },
      { label: "AI Agent", href: "/ai-agent" },
      { label: "CRM", href: "/crm" },
      { label: "Chrome extension", href: "/extension" },
      { label: "Desktop app", href: "/desktop" },
      { label: "Rate limits", href: "/rate-limits" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Docs", href: "/docs" },
      { label: "API reference", href: "/api-reference" },
      { label: "Changelog", href: "/changelog" },
      { label: "Status", href: "/status" },
      { label: "Structured data for LLMs", href: "/llms.txt" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "GDPR", href: "/gdpr" },
      { label: "Security", href: "/security" },
      { label: "Extension privacy", href: "/extension-privacy" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-canvas pb-10">
      {/* The divider the mark sits on top of — same trick lemlist's footer
          uses: a hairline with a small badge straddling it dead-center,
          rather than a logo column competing with the link columns. */}
      <div className="relative w-full">
        <div className="h-px w-full bg-line" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-1.5 shadow-sm">
          <Mark size={28} />
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-wrap gap-8 px-6 sm:gap-12 lg:gap-16">
        {COLUMNS.map((col) => (
          <div key={col.title} className="w-[calc(50%-1rem)] sm:w-auto">
            <div className="font-mono text-xs font-semibold uppercase tracking-widest text-ink-soft">{col.title}</div>
            <ul className="mt-3 space-y-2">
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

      {/* The dark bar — always dark, deliberately not `bg-ink`/`text-ink-invert`:
          those tokens FLIP in dark mode (ink becomes near-white there), which
          would turn this into a light bar exactly when the rest of the page
          goes dark. `.band-dark` (globals.css) is the codebase's existing
          "stays dark regardless of theme" pattern — same one ChannelCards
          already relies on — used here instead for exactly that reason.
          lemlist's own bar pairs copyright with a language switcher; we have
          no i18n, so the theme toggle sits just above it instead, in normal
          flow, where its own light/dark tokens are correct either way. */}
      <div className="mx-auto mt-14 flex max-w-6xl justify-center px-6">
        <ThemeToggle />
      </div>
      <div className="band-dark mx-6 mt-3 flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-3 text-center sm:flex-row sm:gap-4">
        <span className="text-sm">© {new Date().getFullYear()} Followthroo. All rights reserved.</span>
        <span className="hidden opacity-40 sm:inline">·</span>
        <span className="font-mono text-xs opacity-70">
          Built by{" "}
          <a href={BRANDSTAC_URL} target="_blank" rel="noopener noreferrer" className="hover:opacity-100">
            brandstac
          </a>{" "}
          — New Delhi
        </span>
      </div>
    </footer>
  );
}
