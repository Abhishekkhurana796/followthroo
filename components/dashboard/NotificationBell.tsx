"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRightLeft, Bell, Check } from "lucide-react";
import { api } from "@/lib/client";
import { authClient } from "@/lib/auth-client";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};
type Elsewhere = { organizationId: string; name: string; unread: number };
type Payload = { items: Item[]; unread: number; elsewhere?: Elsewhere[] };

/** "2m", "3h", "5d" — short enough to sit in a dense list. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The bell.
 *
 * Exists because assignment used to be silent — the only thing that ever reached
 * a person was a due-date reminder, which arrives when it is already too late to
 * plan around. Email covers people who are not in the app; this covers the far
 * more common case that they are.
 *
 * Polls on a slow interval rather than holding a socket: this is a count that
 * can be a minute stale without anyone minding, and a websocket per signed-in
 * user is a lot of machinery for that.
 */
export function NotificationBell() {
  const { data, mutate } = useSWR<Payload>("/api/notifications", { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];
  const elsewhere = data?.elsewhere ?? [];
  // Counted in the badge on purpose. Unread work in another workspace is exactly
  // the case that read as "I was never told": a teammate in the wrong workspace
  // saw a bell with nothing on it.
  const badge = unread + elsewhere.reduce((n, w) => n + w.unread, 0);

  async function markAllRead() {
    // Optimistic: the count is the whole point of the control, so it should
    // respond to the click rather than to the round trip.
    mutate({ items: items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })), unread: 0, elsewhere }, false);
    await api("/api/notifications", { method: "PATCH", body: {} }).catch(() => {});
    mutate();
  }

  async function switchTo(organizationId: string) {
    // Same as the workspace switcher in the sidebar: every screen reads the
    // active workspace on the server, so a full reload is the honest refresh.
    await authClient.organization.setActive({ organizationId });
    window.location.reload();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={badge ? `Notifications, ${badge} unread` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-tint hover:text-ink"
      >
        <Bell className="h-4.5 w-4.5" />
        {badge > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away. Sits under the panel, over everything else. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-display text-sm font-bold">Notifications</span>
              {unread > 0 && (
                <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
                  <Check className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>

            {elsewhere.length > 0 && (
              <div className="divide-y divide-line border-b border-line bg-tint/40">
                {elsewhere.map((w) => (
                  <div key={w.organizationId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 text-xs text-ink-soft">
                      <b className="text-ink">{w.unread}</b> unread in{" "}
                      <span className="font-medium text-ink">{w.name}</span>
                    </span>
                    <button
                      onClick={() => switchTo(w.organizationId)}
                      className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Switch
                    </button>
                  </div>
                ))}
              </div>
            )}

            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">
                {elsewhere.length > 0 ? "Nothing in this workspace." : "Nothing yet."}
              </p>
            ) : (
              <div className="max-h-96 divide-y divide-line overflow-y-auto">
                {items.map((n) => {
                  const row = (
                    <div className={`px-4 py-3 ${n.readAt ? "" : "bg-tint/50"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{n.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-faint">{ago(n.createdAt)}</span>
                      </div>
                      {n.body && <p className="mt-0.5 text-xs text-ink-soft">{n.body}</p>}
                    </div>
                  );
                  return n.href ? (
                    <Link key={n.id} href={n.href} onClick={() => setOpen(false)} className="block hover:bg-tint">
                      {row}
                    </Link>
                  ) : (
                    <div key={n.id}>{row}</div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
