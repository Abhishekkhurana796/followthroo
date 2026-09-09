"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Globe, ShieldCheck, AtSign, Link2, Check } from "lucide-react";
import { gsap } from "./gsap";


const REASONS = [
  "A separate domain, so a spam flag never reaches the one your invoices go out on.",
  "MX, SPF, DKIM and DMARC checked against live DNS until every one of them resolves.",
  "Connect the mailbox and warm-up starts itself — 21 days before campaign one.",
];

// The four records every sending domain needs. Values are illustrative but real
// in shape — a reader who knows DNS should recognise them, not squint at them.
const RECORDS = [
  { name: "MX", value: "mx.secureserver.net" },
  { name: "SPF", value: "v=spf1 include:secureserver.net -all" },
  { name: "DKIM", value: "selector1._domainkey" },
  { name: "DMARC", value: "v=DMARC1; p=none; rua=..." },
];

const MAILBOXES = [
  { address: "priya@outreach-acme.com", day: 6 },
  { address: "sales@outreach-acme.com", day: 4 },
];

// This IS a real sequence — you cannot verify DNS on a domain you do not own yet,
// or connect a mailbox that does not exist. So the thread encodes true order.
const STAGES = [
  { icon: Globe, label: "Domain" },
  { icon: ShieldCheck, label: "DNS" },
  { icon: AtSign, label: "Mailbox" },
  { icon: Link2, label: "Connected" },
];

const RAMP_DAYS = 21;

/** The end state of the flow, shown rather than described. */
function DomainCard() {
  return (
    <div className="lk-infra-card min-w-0 rounded-[28px] border border-line bg-surface p-6 shadow-sm sm:p-7">
      <div className="flex items-center gap-3 border-b border-line pb-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
          <Globe className="h-5 w-5 text-accent" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-medium">outreach-acme.com</div>
          <div className="text-xs text-ink-soft">Sending domain</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success-strong">
          <Check className="h-3 w-3" aria-hidden /> Verified
        </span>
      </div>

      <ul className="space-y-2.5 py-5">
        {RECORDS.map((r) => (
          <li key={r.name} className="lk-infra-row flex items-center gap-3">
            <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
            <span className="w-14 shrink-0 font-mono text-xs font-medium">{r.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">{r.value}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-line pt-5">
        {MAILBOXES.map((m) => (
          <div key={m.address} className="lk-infra-row flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
              <AtSign className="h-4 w-4 text-ink-soft" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.address}</div>
              <div className="text-xs text-ink-soft">
                Warming up &middot; day {m.day} of {RAMP_DAYS}
              </div>
            </div>
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round((m.day / RAMP_DAYS) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The connection motif, laid flat: four nodes threaded in the order you meet them. */
function StageThread() {
  return (
    <ol className="mt-16 flex items-center justify-between gap-2 sm:gap-4">
      {STAGES.map((s, i) => (
        <React.Fragment key={s.label}>
          <li className="flex shrink-0 flex-col items-center gap-2 text-center">
            <span className="lk-infra-node flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface shadow-sm">
              <s.icon className="h-5 w-5 text-accent" aria-hidden />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-ink-soft">
              {s.label}
            </span>
          </li>
          {i < STAGES.length - 1 && (
            <li aria-hidden className="lk-infra-seg h-px min-w-4 flex-1 origin-left bg-line" />
          )}
        </React.Fragment>
      ))}
    </ol>
  );
}

export default function SendingInfrastructure() {
  const root = useRef<HTMLDivElement>(null);
  const gradient = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const trigger = { trigger: root.current, start: "top 75%" };

      gsap.from(".lk-infra-copy", {
        y: 30,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.1,
        scrollTrigger: trigger,
      });
      gsap.from(".lk-infra-card", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: trigger,
      });
      gsap.from(".lk-infra-row", {
        x: -12,
        opacity: 0,
        duration: 0.5,
        ease: "power2.out",
        stagger: 0.07,
        delay: 0.2,
        scrollTrigger: trigger,
      });
      // The thread reads as one gesture, so it draws on its own later trigger
      // rather than racing the card above it.
      gsap.from(".lk-infra-seg", {
        scaleX: 0,
        duration: 0.6,
        ease: "power2.out",
        stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: "top 62%" },
      });
      gsap.from(".lk-infra-node", {
        scale: 0,
        opacity: 0,
        transformOrigin: "center",
        duration: 0.5,
        ease: "back.out(1.7)",
        stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: "top 62%" },
      });

      // Gradient-text scroll, same as the hero: without it the gradient sits at
      // its 0% position and the word reads as faded rather than emphasised.
      if (gradient.current) {
        gsap.to(gradient.current, {
          backgroundPositionX: "100%",
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: 1 },
        });
      }
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section id="infrastructure" ref={root} className="bg-canvas pb-24 sm:pb-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <span className="lk-infra-copy eyebrow">Sending infrastructure</span>
            <h2 className="lk-infra-copy font-display mt-3 text-[clamp(2rem,4.5vw,3.2rem)] font-bold">
              Never{" "}
              <span ref={gradient} className="gradient-text">
                burn
              </span>{" "}
              your real domain on cold email
            </h2>
            <p className="lk-infra-copy mt-4 text-lg leading-relaxed text-ink-soft">
              Pick a lookalike domain, buy it and its mailboxes in our store, and Followthroo takes
              it from there — verifying every mail record against live DNS, then connecting the
              mailbox and warming it up. Your real domain is never the one on the line.
            </p>

            <ul className="mt-8 space-y-3">
              {REASONS.map((r) => (
                <li key={r} className="lk-infra-copy flex gap-3">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <span className="leading-relaxed text-ink-soft">{r}</span>
                </li>
              ))}
            </ul>

            <div className="lk-infra-copy mt-9">
              <Link href="/dashboard/accounts/new" className="btn btn-primary">
                Get a sending domain <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>

          <DomainCard />
        </div>

        <StageThread />
      </div>
    </section>
  );
}
