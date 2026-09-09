"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const LINKS = [
  { label: "Channels", href: "/channels" },
  { label: "Extension", href: "/extension" },
  { label: "How it works", href: "/#how" },
  { label: "Safety", href: "/#safety" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
];

/** The "Konnect" mark: two nodes joined by a thread. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <line x1="7" y1="13" x2="19" y2="13" stroke="var(--color-action)" strokeWidth="2.4" />
      <circle cx="7" cy="13" r="5" fill="var(--color-brand)" />
      <circle cx="19" cy="13" r="5" fill="var(--color-canvas)" stroke="var(--color-brand)" strokeWidth="2.4" />
    </svg>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "py-2" : "py-4"
      }`}
    >
      <nav
        className={`mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-300 sm:px-5 ${
          scrolled ? "glass" : "bg-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
          <Mark />
          Followthroo
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} className="text-sm font-medium text-ink-soft transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/sign-in" className="btn btn-ghost !py-2 !text-sm">
            Sign in
          </Link>
          <Link href="/sign-up" className="btn btn-primary !py-2 !text-sm">
            Start free
          </Link>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="mx-4 mt-2 rounded-3xl p-2 md:hidden glass">
          <div className="flex flex-col gap-1 p-3">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-black/5 hover:text-ink"
              >
                {l.label}
              </a>
            ))}
            <Link href="/sign-up" className="btn btn-primary mt-2 justify-center">
              Start free
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
