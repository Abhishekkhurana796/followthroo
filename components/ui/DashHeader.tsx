"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { NotificationBell } from "@/components/dashboard/NotificationBell";

export function DashHeader({
  title,
  subtitle,
  action,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Optional trail rendered above the title — used by the settings sub-pages. */
  breadcrumb?: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 py-6">
      <div className="flex items-start gap-3">
        {/* Every screen renders a DashHeader, which is what makes this a
            universal back button rather than something each page has to
            remember to add. Browser history, not a hardcoded parent route —
            a page reached three clicks deep (a lead, a campaign step, a
            settings sub-page) goes back exactly the way it was reached. */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-tint hover:text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          {breadcrumb}
          <h1 className="font-display text-2xl font-extrabold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {/* The bell lives here rather than in the sidebar: the rail is navigation,
          and a notification count is not a destination. Every screen renders a
          DashHeader, so putting it here makes it global without adding a row. */}
      <div className="flex items-center gap-2">
        {action}
        <NotificationBell />
      </div>
    </div>
  );
}
