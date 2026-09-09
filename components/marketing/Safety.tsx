"use client";

import React, { useEffect, useRef } from "react";
import { gsap } from "./gsap";


const GUARDRAILS = [
  { channel: "Email", value: "500–2,000", unit: "per day", note: "Gmail-aware, paced hourly", color: "var(--color-ch-email)" },
  { channel: "LinkedIn", value: "~20", unit: "invites / day", note: "ramps with acceptance", color: "var(--color-ch-linkedin)" },
  { channel: "WhatsApp", value: "250", unit: "per 24h", note: "tiers up on verification", color: "var(--color-ch-whatsapp)" },
];

export default function Safety() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".lk-guard", {
        y: 30,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: "top 75%" },
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section id="safety" ref={root} className="bg-canvas pb-24 sm:pb-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="overflow-hidden rounded-[32px] bg-tint p-8 sm:p-14">
          <div className="max-w-2xl">
            <span className="eyebrow" style={{ color: "var(--color-brand-ink)" }}>
              Built-in guardrails
            </span>
            <h2 className="font-display mt-3 text-[clamp(1.9rem,4vw,3rem)] font-bold text-ink">
              Send at volume without <span className="gradient-text">waking the spam kraken</span>
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-soft">
              Every platform has hard limits. Followthroo knows them, throttles to them, and adds
              human-like jitter — so accounts stay healthy while you scale.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {GUARDRAILS.map((g) => (
              <div key={g.channel} className="lk-guard rounded-2xl border border-line bg-surface p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                  <span className="text-sm font-semibold">{g.channel}</span>
                </div>
                <div className="font-display mt-4 text-4xl font-extrabold" style={{ color: g.color }}>
                  {g.value}
                </div>
                <div className="font-mono text-xs text-ink-soft">{g.unit}</div>
                <p className="mt-3 text-sm text-ink-soft">{g.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
