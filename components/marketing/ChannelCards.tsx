"use client";

import React, { useEffect, useRef } from "react";
import { Mail, Linkedin, MessageCircle, MessagesSquare, Database, Bot } from "lucide-react";
import { gsap } from "./gsap";


type Card = { icon: typeof Mail; title: string; metric: string; blurb: string };

const CARDS: Card[] = [
  { icon: Mail, title: "Email", metric: "40 / hour", blurb: "DKIM-signed, warmed up, and paced so you land in the inbox — not spam." },
  { icon: Linkedin, title: "LinkedIn", metric: "~20 invites / day", blurb: "Humanized timing and gradual ramps that mimic real activity." },
  { icon: MessageCircle, title: "WhatsApp", metric: "250 / 24h", blurb: "Opt-in aware, template-approved, quality-rating safe." },
  { icon: MessagesSquare, title: "Social", metric: "on-brand", blurb: "Drop a comment where the conversation is already happening." },
  { icon: Database, title: "CRM", metric: "every touch", blurb: "Leads, stages, and each channel's activity in one timeline." },
  { icon: Bot, title: "AI Agent", metric: "claude-opus-4-8", blurb: "Runs the whole sequence for you — and never outruns a rate limit." },
];

export default function ChannelCards() {
  const section = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !track.current) return;

      const distance = () => Math.max(0, track.current!.scrollWidth - window.innerWidth);

      // Pin the section and translate the equal-gap row horizontally on scroll.
      gsap.to(track.current, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: () => "+=" + distance(),
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="channels"
      ref={section}
      className="band-dark relative flex min-h-screen flex-col justify-center overflow-hidden py-20"
    >
      <div className="mx-auto mb-12 max-w-6xl px-6 text-center">
        <span className="eyebrow !text-white/45">Every channel, one system</span>
        <h2 className="font-display mt-3 text-[clamp(2rem,4.5vw,3.2rem)] font-bold">
          Scroll through the <span className="gradient-text-dark">stack</span>
        </h2>
      </div>

      {/* Equal-gap row; reduced-motion users get a manual horizontal scroll. */}
      <div className="w-full overflow-x-auto motion-safe:overflow-visible [scrollbar-width:none]">
        <div ref={track} className="flex w-max gap-6 px-[8vw] sm:gap-8">
          {CARDS.map((c) => (
            <article
              key={c.title}
              className="glass-dark group flex h-[340px] w-[280px] shrink-0 flex-col rounded-[24px] p-7 transition-transform duration-300 hover:-translate-y-1.5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#0a0a0a]">
                <c.icon className="h-6 w-6" />
              </div>
              <div className="mt-auto">
                <div className="font-mono text-xs uppercase tracking-widest text-white/45">{c.metric}</div>
                <h3 className="font-display mt-1 text-2xl font-bold">{c.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{c.blurb}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="mt-12 text-center font-mono text-xs text-white/35">scroll →</p>
    </section>
  );
}
