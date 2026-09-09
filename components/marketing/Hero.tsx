"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Mail, Linkedin, MessageCircle } from "lucide-react";
import { gsap } from "./gsap";


/**
 * Connection graph: three channel nodes thread into one lead node, with pulses
 * traveling along each thread — the literal "Konnect". Embodies multi-channel-synced.
 */
const CHANNELS = [
  { icon: Mail, label: "Email", color: "var(--color-ch-email)", from: { x: 40, y: 40 } },
  { icon: Linkedin, label: "LinkedIn", color: "var(--color-ch-linkedin)", from: { x: 40, y: 140 } },
  { icon: MessageCircle, label: "WhatsApp", color: "var(--color-ch-whatsapp)", from: { x: 40, y: 240 } },
];
const LEAD = { x: 300, y: 140 };

function ConnectionGraph() {
  return (
    <svg viewBox="0 0 360 280" className="h-full w-full overflow-visible" aria-hidden>
      {/* threads */}
      {CHANNELS.map((c, i) => (
        <path
          key={i}
          className="lk-thread"
          d={`M ${c.from.x} ${c.from.y} C ${c.from.x + 110} ${c.from.y}, ${LEAD.x - 120} ${LEAD.y}, ${LEAD.x} ${LEAD.y}`}
          fill="none"
          stroke={c.color}
          strokeWidth="2"
          strokeOpacity="0.35"
        />
      ))}
      {/* pulses (animated by GSAP via offsetPath) */}
      {CHANNELS.map((c, i) => (
        <circle key={`p${i}`} className={`lk-pulse lk-pulse-${i}`} r="4" fill={c.color} />
      ))}
      {/* channel nodes */}
      {CHANNELS.map((c, i) => (
        <g key={`n${i}`} className="lk-node" transform={`translate(${c.from.x - 20} ${c.from.y - 20})`}>
          <rect width="40" height="40" rx="12" fill="var(--color-surface)" stroke={c.color} strokeWidth="2" />
        </g>
      ))}
      {/* lead node */}
      <g className="lk-lead" transform={`translate(${LEAD.x - 26} ${LEAD.y - 26})`}>
        <rect width="52" height="52" rx="16" fill="var(--color-ink)" />
        <text x="26" y="33" textAnchor="middle" fill="var(--color-ink-invert)" fontSize="20" fontFamily="var(--font-display)" fontWeight="700">
          JD
        </text>
      </g>
    </svg>
  );
}

export default function Hero() {
  const root = useRef<HTMLDivElement>(null);
  const gradient = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Load timeline
      if (!reduce) {
        gsap.from(".lk-rise", {
          y: 26,
          opacity: 0,
          duration: 0.85,
          ease: "power3.out",
          stagger: 0.09,
        });
        gsap.from(".lk-node, .lk-lead", {
          scale: 0,
          transformOrigin: "center",
          opacity: 0,
          duration: 0.6,
          ease: "back.out(1.7)",
          stagger: 0.12,
          delay: 0.3,
        });

        // Pulses travel each thread on repeat
        document.querySelectorAll<SVGPathElement>(".lk-thread").forEach((path, i) => {
          const len = path.getTotalLength();
          const pulse = root.current?.querySelector<SVGCircleElement>(`.lk-pulse-${i}`);
          if (!pulse) return;
          gsap.set(pulse, { opacity: 0 });
          const obj = { t: 0 };
          gsap.to(obj, {
            t: 1,
            duration: 2.2,
            ease: "power1.inOut",
            repeat: -1,
            delay: i * 0.6,
            onUpdate: () => {
              const p = path.getPointAtLength(obj.t * len);
              gsap.set(pulse, { attr: { cx: p.x, cy: p.y }, opacity: obj.t > 0.02 && obj.t < 0.98 ? 1 : 0 });
            },
          });
        });

        // Gradient-text scroll: shift the gradient position as the page scrolls.
        if (gradient.current) {
          gsap.to(gradient.current, {
            backgroundPositionX: "100%",
            ease: "none",
            scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: 1 },
          });
        }
      }
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={root}
      className="relative overflow-hidden bg-canvas pt-32 pb-20 sm:pt-40 sm:pb-28"
    >
      <div className="absolute inset-0 grid-dots opacity-70" />
      <div className="absolute inset-x-0 top-0 h-[420px] glow-brand" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: copy */}
        <div>
          <h1 className="font-display text-[clamp(2.6rem,6vw,4.6rem)] font-extrabold">
            <span className="lk-rise block">Reach every lead</span>
            <span className="lk-rise block">
              where they actually{" "}
              <span ref={gradient} className="gradient-text">
                reply.
              </span>
            </span>
          </h1>

          <p className="lk-rise mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            Email, LinkedIn, and WhatsApp — personalized at scale, sequenced, and throttled so you book
            more meetings without ever tripping the spam kraken.
          </p>

          <div className="lk-rise mt-8 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="btn btn-primary">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#how" className="btn btn-ghost">
              See how it works
            </a>
          </div>

          <div className="lk-rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-ink-soft">
            <span>◆ Throttled by default</span>
            <span>◆ GDPR-ready</span>
            <span>◆ No card required</span>
          </div>
        </div>

        {/* Right: connection graph in a glass card */}
        <div className="lk-rise relative">
          <div className="glass rounded-[28px] p-6 sm:p-8">
            <div className="mb-4 flex items-center justify-between">
              <span className="eyebrow">Live sequence</span>
              <span className="font-mono text-xs text-ink-soft">3 channels → 1 reply</span>
            </div>
            <div className="aspect-[360/280] w-full">
              <ConnectionGraph />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {CHANNELS.map((c) => (
                <div key={c.label} className="flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2">
                  <c.icon className="h-4 w-4" style={{ color: c.color }} />
                  <span className="text-xs font-medium">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
