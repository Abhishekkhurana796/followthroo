"use client";

import { useState } from "react";
import useSWR from "swr";
import { DashHeader, Panel, Banner, Skeleton } from "@/components/ui";
import { api } from "@/lib/client";

type Prefs = { taskReminders: boolean; dailyDigest: boolean; taskAssigned: boolean; leadAssigned: boolean };

/**
 * Only what actually sends.
 *
 * This screen used to offer four toggles — new reply, campaign finished, weekly
 * summary, deliverability alerts — none of which had any backend, saved to
 * localStorage, and admitted it in the footer. They have been removed rather
 * than left as decoration: a switch that promises an email nobody will ever
 * receive is worse than no switch. They can come back when something implements
 * them.
 */
const OPTIONS: { key: keyof Prefs; title: string; desc: string }[] = [
  {
    key: "taskAssigned",
    title: "Task assigned to you",
    desc: "An email the moment someone hands you a task, rather than waiting for it to come due. It always appears in your notifications either way.",
  },
  {
    key: "leadAssigned",
    title: "Contact assigned to you",
    desc: "An email when a contact is routed or handed to you. A batch — an import, say — arrives as one message, not one per contact.",
  },
  {
    key: "taskReminders",
    title: "Task reminders",
    desc: "An email when one of your tasks comes due, and a nudge to your manager if it stays open a day past that.",
  },
  {
    key: "dailyDigest",
    title: "Morning digest",
    desc: "One email at 8am listing what is overdue and what is due today. Nothing is sent on a day with nothing due.",
  },
];

export default function Page() {
  const { data, mutate, isLoading } = useSWR<Prefs>("/api/notifications/prefs");
  const [busy, setBusy] = useState<keyof Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof Prefs) {
    if (!data) return;
    const next = { ...data, [key]: !data[key] };
    setBusy(key);
    setError(null);
    // Optimistic: a switch that waits on a round trip before moving feels broken.
    mutate(next, false);
    try {
      const saved = await api<Prefs>("/api/notifications/prefs", {
        method: "PATCH",
        body: { [key]: next[key] },
      });
      mutate(saved, false);
    } catch (e) {
      setError((e as Error).message);
      mutate(data, false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DashHeader title="Notifications" subtitle="Choose what we email you about." />
      <div className="max-w-2xl space-y-4 p-8">
        {error && <Banner kind="error">{error}</Banner>}

        <Panel className="divide-y divide-line !p-0">
          {OPTIONS.map((o) => {
            const on = data?.[o.key] ?? true;
            return (
              <div key={o.key} className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{o.title}</div>
                  <div className="text-xs text-ink-soft">{o.desc}</div>
                </div>
                {isLoading ? (
                  <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
                ) : (
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={o.title}
                    disabled={busy === o.key}
                    onClick={() => toggle(o.key)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60 ${
                      on ? "bg-accent" : "bg-line"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition ${
                        on ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </Panel>

        <p className="text-xs text-ink-soft">
          Saved to your account, so it applies wherever you sign in. Reminders send from the
          platform mailbox — if none is configured, nothing is sent and nothing is queued.
        </p>
      </div>
    </>
  );
}
