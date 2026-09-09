"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X, Twitter, Linkedin, Github, Mail } from "lucide-react";

const NAV_LINKS = ["Channels", "How it works", "Safety", "Pricing", "Docs"];

const FOOTER_COLUMNS: { title: string; links: string[] }[] = [
  { title: "PRODUCT", links: ["Channels", "Sequences", "Templates", "AI Agent", "CRM"] },
  { title: "RESOURCES", links: ["Docs", "API Reference", "Rate limits", "Status", "Changelog"] },
  { title: "COMPANY", links: ["About", "Careers", "Blog", "Contact"] },
];

const SOCIALS = [Twitter, Linkedin, Github, Mail];

/** The "Konnect" mark. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <line x1="7" y1="13" x2="19" y2="13" stroke="var(--color-action)" strokeWidth="2.4" />
      <circle cx="7" cy="13" r="5" fill="var(--color-brand)" />
      <circle cx="19" cy="13" r="5" fill="var(--color-canvas)" stroke="var(--color-brand)" strokeWidth="2.4" />
    </svg>
  );
}

export default function NotFound() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const close = () => {
    setVisible(false);
    setTimeout(() => setOpen(false), 400);
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-canvas text-ink">
      <div className="pointer-events-none absolute inset-0 grid-dots opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[380px] glow-brand" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Nav */}
        <nav className="flex items-center justify-between px-6 py-5 md:px-12 lg:px-16">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
            <Mark /> Followthroo
          </Link>

          <div className="hidden items-center gap-7 lg:flex">
            {NAV_LINKS.map((l) => (
              <a key={l} href="/" className="text-sm font-medium text-ink-soft transition-colors hover:text-ink">
                {l}
              </a>
            ))}
          </div>

          <div className="hidden lg:block">
            <Link href="/dashboard" className="btn btn-primary !py-2 !text-sm">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <button onClick={() => (open ? close() : setOpen(true))} className="lg:hidden" aria-label="Toggle menu">
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </nav>

        {/* Mobile menu */}
        {open && (
          <>
            <div
              onClick={close}
              className={`fixed inset-0 z-40 bg-ink/20 backdrop-blur-sm transition-opacity duration-300 ${
                visible ? "opacity-100" : "opacity-0"
              }`}
            />
            <div className="absolute inset-x-4 top-[70px] z-50 rounded-3xl p-3 glass">
              <div className="flex flex-col gap-1">
                {NAV_LINKS.map((l, i) => (
                  <a
                    key={l}
                    href="/"
                    onClick={close}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft transition-all hover:bg-black/5 hover:text-ink"
                    style={{
                      opacity: visible ? 1 : 0,
                      transform: visible ? "translateY(0)" : "translateY(8px)",
                      transitionDelay: `${visible ? 120 + i * 40 : 0}ms`,
                    }}
                  >
                    {l}
                  </a>
                ))}
                <Link href="/dashboard" className="btn btn-primary mt-2 justify-center">
                  Start free
                </Link>
              </div>
            </div>
          </>
        )}

        {/* Hero / 404 */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <span className="eyebrow inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-action)" }} />
            Error 404
          </span>

          <h1 className="font-display mt-6 text-lg font-medium text-ink-soft sm:text-2xl">
            This lead went cold.
          </h1>

          <div className="my-6">
            <span className="font-display gradient-text text-[100px] font-extrabold leading-none sm:text-[180px] lg:text-[240px]">
              404
            </span>
          </div>

          <p className="max-w-md text-ink-soft">
            The page you're after didn't reply. Let's get you back to a channel that will.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn btn-primary">
              Back to home <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/dashboard" className="btn btn-ghost">
              Go to dashboard
            </Link>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-line px-6 pb-10 pt-12 md:px-12 lg:px-16">
          <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 font-display font-bold">
                <Mark /> Followthroo
              </div>
              <p className="mt-3 max-w-xs text-sm text-ink-soft">
                Multi-channel outreach that gets replies — without tripping the spam kraken.
              </p>
              <div className="mt-4 flex gap-3">
                {SOCIALS.map((Icon, i) => (
                  <a key={i} href="#" className="text-ink-soft transition-colors hover:text-brand">
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            </div>
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="font-mono text-xs uppercase tracking-widest text-ink-soft">{col.title}</div>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <a href="#" className="text-sm text-ink-soft transition-colors hover:text-ink">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
