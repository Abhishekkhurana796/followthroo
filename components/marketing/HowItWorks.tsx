"use client";

import React, { useEffect, useRef } from "react";
import { Upload, Sparkles, Waypoints, ShieldCheck } from "lucide-react";
import { gsap } from "./gsap";


// This IS a real sequence, so numbered steps encode true order.
const STEPS = [
  { n: "01", icon: Upload, title: "Import your leads", body: "Drop a CSV — unknown columns become personalization variables automatically. Duplicates dedupe by email." },
  { n: "02", icon: Sparkles, title: "Personalize once", body: "Write one template with {{firstName}} and fallbacks. It flexes to thousands of leads without reading like a blast." },
  { n: "03", icon: Waypoints, title: "Orchestrate channels", body: "Sequence email → LinkedIn → WhatsApp with waits. A reply anywhere pauses the rest for that lead." },
  { n: "04", icon: ShieldCheck, title: "Stay safe by default", body: "Every send passes a rate limit and suppression check first. Hit a cap and it queues for the next window." },
];

export default function HowItWorks() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".lk-step", {
        y: 40,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: "top 72%" },
      });
      gsap.from(".lk-rail", {
        scaleY: 0,
        transformOrigin: "top",
        duration: 1.1,
        ease: "power2.out",
        scrollTrigger: { trigger: root.current, start: "top 72%" },
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section id="how" ref={root} className="relative bg-canvas py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <span className="eyebrow">The flow</span>
          <h2 className="font-display mt-3 text-[clamp(2rem,4.5vw,3.2rem)] font-bold">
            Four steps to a full pipeline
          </h2>
        </div>

        <div className="relative mt-16 pl-2">
          {/* vertical rail */}
          <div className="lk-rail absolute left-[27px] top-2 bottom-2 w-px bg-line sm:left-[31px]" />
          <div className="flex flex-col gap-10">
            {STEPS.map((s) => (
              <div key={s.n} className="lk-step relative flex gap-5 sm:gap-7">
                <div className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface shadow-sm">
                  <s.icon className="h-6 w-6 text-brand" />
                </div>
                <div className="pt-1.5">
                  <div className="font-mono text-xs tracking-widest text-brand">{s.n}</div>
                  <h3 className="font-display mt-1 text-2xl font-bold">{s.title}</h3>
                  <p className="mt-2 max-w-xl leading-relaxed text-ink-soft">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
