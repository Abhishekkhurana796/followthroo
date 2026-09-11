"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, HelpCircle, ShieldCheck, Zap, Mail } from "lucide-react";

export interface FAQItem {
  id: string;
  category: "General" | "LinkedIn Safety" | "Integrations" | "Pricing";
  question: string;
  answer: string | React.ReactNode;
}

const FAQS: FAQItem[] = [
  {
    id: "faq-1",
    category: "General",
    question: "What is Followthroo and how does multi-channel outreach work?",
    answer:
      "Followthroo is an AI-powered outreach platform that connects Email, LinkedIn, and WhatsApp into single automated sequences. Instead of managing tools in silos, Followthroo tracks lead state centrally so when a prospect replies on email, their LinkedIn sequence automatically pauses.",
  },
  {
    id: "faq-2",
    category: "LinkedIn Safety",
    question: "Is LinkedIn automation safe for my personal account?",
    answer:
      "As safe as we can make it, not risk-free — automated sending is against LinkedIn's User Agreement, and we say so plainly rather than pretend otherwise. Invitations go out from a small Windows app on your own computer, at your own pace (45–120 seconds apart, capped at 20 a day), using your real browser session — never a server pretending to be you. It never touches your actual mouse or keyboard; every click is a synthesized event inside its own separate window, so you can keep working the whole time.",
  },
  {
    id: "faq-3",
    category: "Integrations",
    question: "Which email providers are supported, and what about my existing CRM?",
    answer:
      "Connect Gmail or Google Workspace in one click, or Zoho Mail — or any mailbox over plain SMTP, which covers Outlook, Office 365 and most others. Followthroo is the CRM: leads, pipelines and the full conversation history live here rather than needing to sync with a separate one. Leads still arrive from wherever you already generate them — a CSV import, or an inbound webhook from IndiaMART, JustDial, Google Ads, Meta Lead Ads or your own site.",
  },
  {
    id: "faq-4",
    category: "Pricing",
    question: "Can I try Followthroo for free before subscribing?",
    answer:
      "Yes. The Starter plan is free forever, with 1 sending account and 500 leads — no card required. You can also start a free trial of the Growth plan the same way, straight from the pricing page.",
  },
  {
    id: "faq-5",
    category: "LinkedIn Safety",
    question: "What happens if a prospect replies to my outreach message?",
    answer:
      "Followthroo automatically detects incoming replies across all channels and marks the lead as 'Replied', immediately stopping further automated follow-up steps so you can take over with a human response.",
  },
  {
    id: "faq-6",
    category: "General",
    question: "How is Followthroo different from lemlist or Instantly?",
    answer:
      "While single-channel tools focus strictly on email or LinkedIn in isolation, Followthroo synchronizes multi-channel state natively under one roof. Our AI agent also analyzes target profiles to generate tailored opener copy per channel.",
  },
];

export function FAQ() {
  const [query, setQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState<string>("All");
  const [openId, setOpenId] = useState<string | null>("faq-1");

  const categories = ["All", "General", "LinkedIn Safety", "Integrations", "Pricing"];

  const filteredFaqs = FAQS.filter((f) => {
    const matchesCat = selectedCat === "All" || f.category === selectedCat;
    const matchesQuery =
      f.question.toLowerCase().includes(query.toLowerCase()) ||
      (typeof f.answer === "string" && f.answer.toLowerCase().includes(query.toLowerCase()));
    return matchesCat && matchesQuery;
  });

  // JSON-LD structured data for AEO / Google FAQPage rich results
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: typeof f.answer === "string" ? f.answer : f.question,
      },
    })),
  };

  return (
    <section className="bg-canvas py-20 relative overflow-hidden" id="faq">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="mx-auto max-w-5xl px-6">
        {/* Section Header */}
        <div className="text-center">
          <span className="eyebrow !text-accent font-semibold">Got Questions?</span>
          <h2 className="font-display mt-3 text-[clamp(2rem,4.5vw,3.2rem)] font-bold tracking-tight text-ink">
            Frequently Asked <span className="gradient-text">Questions</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
            Everything you need to know about Followthroo's multi-channel outreach, LinkedIn safety guardrails, and setup.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                  selectedCat === cat
                    ? "bg-accent text-white shadow-md shadow-accent/20"
                    : "bg-surface text-ink-soft border border-line hover:text-ink hover:border-accent/40"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="relative sm:w-64">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-ink-soft" />
            <input
              type="text"
              placeholder="Search questions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-4 text-xs text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {/* Accordion List */}
        <div className="mt-8 space-y-3">
          {filteredFaqs.length === 0 ? (
            <div className="rounded-3xl border border-line bg-surface p-8 text-center text-ink-soft">
              No matching questions found for "{query}".
            </div>
          ) : (
            filteredFaqs.map((faq) => {
              const isOpen = openId === faq.id;
              return (
                <div
                  key={faq.id}
                  className={`overflow-hidden rounded-2xl border transition-all duration-200 ${
                    isOpen
                      ? "border-accent/40 bg-surface shadow-lg shadow-accent/5 ring-1 ring-accent/20"
                      : "border-line bg-surface/70 hover:border-accent/30"
                  }`}
                >
                  <button
                    onClick={() => setOpenId(isOpen ? null : faq.id)}
                    className="flex w-full items-center justify-between p-5 text-left"
                  >
                    <span className="font-display text-base font-bold text-ink pr-4">{faq.question}</span>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-200 ${
                      isOpen ? "bg-accent text-white rotate-180" : "bg-accent/10 text-accent"
                    }`}>
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-5 pt-1 text-sm leading-relaxed text-ink-soft border-t border-line/50">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Help Banner */}
        <div className="mt-12 rounded-3xl bg-accent/5 border border-accent/20 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">Have a specific question not covered here?</h3>
            <p className="mt-1 text-xs text-ink-soft">Our team is available to help you configure custom outreach flows.</p>
          </div>
          <Link href="/contact" className="btn btn-primary !py-2.5 !px-5 !text-xs shrink-0">
            Contact Sales & Support
          </Link>
        </div>
      </div>
    </section>
  );
}

export default FAQ;
