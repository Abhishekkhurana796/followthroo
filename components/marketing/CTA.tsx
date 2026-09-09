"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Footer from "@/components/site/Footer";

export default function CTA() {
  return (
    <>
      {/* CTA band */}
      <section className="bg-canvas pb-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="relative overflow-hidden rounded-[32px] bg-ink px-8 py-16 text-center text-ink-invert sm:px-14 sm:py-24">
            <div className="pointer-events-none absolute inset-0 opacity-[0.08] grid-dots" style={{ filter: "invert(1)" }} />
            <div className="relative">
              <h2 className="font-display mx-auto max-w-2xl text-[clamp(2rem,5vw,3.6rem)] font-extrabold">
                Start reaching leads <span className="gradient-text-dark">where they reply</span>
              </h2>
              <p className="mx-auto mt-4 max-w-md text-white/60">
                Import a list, write one message, let Followthroo run the rest — safely.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/dashboard" className="btn btn-primary">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/dashboard" className="btn btn-ghost !border-white/25 !text-white hover:!border-white">
                  Book a demo
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
