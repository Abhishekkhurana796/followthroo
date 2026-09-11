"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Menu,
  X,
  ChevronDown,
  Mail,
  Linkedin,
  MessageSquare,
  Repeat,
  FileText,
  Users,
  Sparkles,
  ShieldCheck,
  Gauge,
  BookOpen,
  Code,
  Layers,
  Clock,
  Activity,
  Shield,
  Chrome,
  Laptop,
} from "lucide-react";
import Mark from "@/components/site/Mark";
import NavDropdown, { type MegaMenuColumn } from "@/components/marketing/NavDropdown";

const PRODUCT_COLUMNS: MegaMenuColumn[] = [
  {
    category: "Channels",
    items: [
      {
        title: "Email Outreach",
        description: "High-deliverability email warm-up, rotation, and inbox sync",
        href: "/channels",
        icon: Mail,
      },
      {
        title: "LinkedIn Automation",
        description: "Auto-connect, InMail, messaging, and profile visits",
        href: "/channels",
        icon: Linkedin,
      },
      {
        title: "WhatsApp Messaging",
        description: "Direct 1:1 engagement on personal and business WhatsApp",
        href: "/channels",
        icon: MessageSquare,
      },
      {
        title: "Chrome Extension",
        description: "Add people to your CRM from any LinkedIn page you're already on",
        href: "/extension",
        icon: Chrome,
      },
      {
        title: "Desktop App",
        description: "Sends your queued LinkedIn invitations from your own computer",
        href: "/desktop",
        icon: Laptop,
      },
    ],
  },
  {
    category: "Outreach & CRM",
    items: [
      {
        title: "Multi-Channel Sequences",
        description: "Combine email, LinkedIn, and WhatsApp into automated steps",
        href: "/sequences",
        icon: Repeat,
      },
      {
        title: "Personalized Templates",
        description: "Variable syntax and AI copy hints per channel",
        href: "/templates",
        icon: FileText,
      },
      {
        title: "Lead CRM & Pipeline",
        description: "Lead status, custom fields, and real-time activity sync",
        href: "/crm",
        icon: Users,
      },
    ],
  },
  {
    category: "AI & Safety",
    items: [
      {
        title: "AI Prospecting Agent",
        description: "Research target accounts and draft personalized hooks",
        href: "/ai-agent",
        icon: Sparkles,
        badge: "AI",
      },
      {
        title: "Safety & Guardrails",
        description: "Human behavior delays, queue safety, and suppression list",
        href: "/#safety",
        icon: ShieldCheck,
      },
      {
        title: "Rate Limits",
        description: "Enforced safe daily quota limits per sending account",
        href: "/rate-limits",
        icon: Gauge,
      },
    ],
  },
];

const RESOURCE_COLUMNS: MegaMenuColumn[] = [
  {
    category: "Learn & API",
    items: [
      {
        title: "Documentation",
        description: "Setup guides, channel setup, and campaign strategies",
        href: "/docs",
        icon: BookOpen,
      },
      {
        title: "API Reference",
        description: "REST API endpoints for workspace and lead automation",
        href: "/api-reference",
        icon: Code,
      },
    ],
  },
  {
    category: "Company & Compliance",
    items: [
      {
        title: "Product Blog",
        description: "Outreach tactics, growth playbooks, and feature news",
        href: "/blog",
        icon: Layers,
      },
      {
        title: "Changelog",
        description: "Latest features, fixes, and release version history",
        href: "/changelog",
        icon: Clock,
      },
      {
        title: "System Status",
        description: "Real-time uptime and channel operational health",
        href: "/status",
        icon: Activity,
      },
      {
        title: "Security & GDPR",
        description: "Data protection standards, sub-processors, and privacy",
        href: "/gdpr",
        icon: Shield,
      },
    ],
  },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<"product" | "resources" | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "py-2" : "py-4"}`}>
      <nav
        className={`mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-300 sm:px-6 ${
          scrolled ? "glass shadow-md" : "bg-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
          <Mark />
          <span>Followthroo</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-7 md:flex">
          <NavDropdown label="Product" columns={PRODUCT_COLUMNS} placement="bottom-start" />
          <NavDropdown label="Resources" columns={RESOURCE_COLUMNS} placement="bottom-start" />
          <Link href="/pricing" className="text-sm font-medium text-ink-soft transition-colors hover:text-ink">
            Pricing
          </Link>
        </div>

        {/* Desktop CTA Cluster: Log in / Get a demo / Sign up for free */}
        <div className="hidden items-center gap-2 md:flex">
          <Link href="/sign-in" className="btn btn-ghost !py-2 !px-3.5 !text-xs">
            Log in
          </Link>
          <Link href="/contact" className="btn btn-ghost !py-2 !px-3.5 !text-xs">
            Get a demo
          </Link>
          <Link href="/sign-up" className="btn btn-primary !py-2 !px-4 !text-xs">
            Sign up for free
          </Link>
        </div>

        {/* Mobile Toggle Button */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="p-1.5 text-ink md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile Drawer Menu */}
      {open && (
        <div className="mx-4 mt-2 max-h-[85vh] overflow-y-auto rounded-3xl p-4 md:hidden glass shadow-2xl">
          <div className="flex flex-col gap-2">
            {/* Product Accordion */}
            <div>
              <button
                onClick={() => setMobileSection(mobileSection === "product" ? null : "product")}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-ink"
              >
                <span>Product</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${mobileSection === "product" ? "rotate-180 text-accent" : ""}`} />
              </button>
              {mobileSection === "product" && (
                <div className="ml-3 mt-1 space-y-1 border-l-2 border-accent/20 pl-3">
                  {PRODUCT_COLUMNS.flatMap((c) => c.items).map((item) => (
                    <Link
                      key={item.title}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2.5 rounded-lg py-1.5 text-xs text-ink-soft hover:text-accent"
                    >
                      <item.icon className="h-3.5 w-3.5 text-accent" />
                      <span>{item.title}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Resources Accordion */}
            <div>
              <button
                onClick={() => setMobileSection(mobileSection === "resources" ? null : "resources")}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-ink"
              >
                <span>Resources</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${mobileSection === "resources" ? "rotate-180 text-accent" : ""}`} />
              </button>
              {mobileSection === "resources" && (
                <div className="ml-3 mt-1 space-y-1 border-l-2 border-accent/20 pl-3">
                  {RESOURCE_COLUMNS.flatMap((c) => c.items).map((item) => (
                    <Link
                      key={item.title}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2.5 rounded-lg py-1.5 text-xs text-ink-soft hover:text-accent"
                    >
                      <item.icon className="h-3.5 w-3.5 text-accent" />
                      <span>{item.title}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <Link
              href="/pricing"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-black/5"
            >
              Pricing
            </Link>

            <div className="mt-4 flex flex-col gap-2 pt-2 border-t border-line">
              <Link href="/sign-in" onClick={() => setOpen(false)} className="btn btn-ghost justify-center">
                Log in
              </Link>
              <Link href="/contact" onClick={() => setOpen(false)} className="btn btn-ghost justify-center">
                Get a demo
              </Link>
              <Link href="/sign-up" onClick={() => setOpen(false)} className="btn btn-primary justify-center">
                Sign up for free
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
