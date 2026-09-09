"use client";

import React from "react";
import { cn } from "@/lib/cn";

const CONTROL = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-ink";

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-ink-soft">
      {children}
    </label>
  );
}

// `ComponentPropsWithRef` rather than `*HTMLAttributes` so callers can pass a
// ref directly — React 19 hands it to function components as an ordinary prop,
// so no forwardRef wrapper is needed.
export function Input({ className, ...props }: React.ComponentPropsWithRef<"input">) {
  return <input {...props} className={cn(CONTROL, className)} />;
}

export function Textarea({ className, ...props }: React.ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={cn(CONTROL, className)} />;
}

export function Select({ className, ...props }: React.ComponentPropsWithRef<"select">) {
  return <select {...props} className={cn(CONTROL, className)} />;
}

