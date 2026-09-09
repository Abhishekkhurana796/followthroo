"use client";

import React from "react";

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
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 py-6">
      <div>
        {breadcrumb}
        <h1 className="font-display text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
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
