"use client";

import { cn } from "@/lib/cn";

/**
 * Placeholder block. Sizes are supplied by the caller so the skeleton occupies
 * the same box the real content will — that is the whole point of it, and it is
 * what keeps the tour spotlight from jumping when data lands.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-tint", className)} />;
}

/** Announces that content is loading without describing the placeholder boxes. */
export function LoadingRegion({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
