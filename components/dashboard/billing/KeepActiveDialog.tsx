"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Badge, Button, Dialog, Skeleton } from "@/components/ui";
import { api } from "@/lib/client";
import { roleLabel } from "@/lib/roles";

type Data = {
  plan: { id: string; name: string } | null;
  limits: { campaigns: number; inboxes: number; users: number };
  campaigns: { id: string; name: string; status: string }[];
  inboxes: { id: string; email: string; provider: string; active: boolean }[];
  people: { id: string; role: string; active: boolean; name: string; email: string }[];
};

const PROVIDERS: Record<string, string> = { gmail_oauth: "Gmail", zoho_oauth: "Zoho", smtp: "SMTP" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Row = { id: string; label: string; meta: string; locked?: boolean };

function Section({
  title,
  limit,
  rows,
  chosen,
  onToggle,
  off,
}: {
  title: string;
  limit: number;
  rows: Row[];
  chosen: Set<string>;
  onToggle: (id: string) => void;
  off: "Pauses" | "Stops sending" | "Read-only";
}) {
  if (!rows.length) return null;
  const full = chosen.size >= limit;
  return (
    <section className="mt-5 first:mt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">{title}</h3>
        <span className={`font-mono text-xs ${chosen.size > limit ? "text-danger" : "text-accent-strong"}`}>
          {chosen.size} of {limit} chosen
        </span>
      </div>
      <ul className="mt-2 overflow-hidden rounded-xl border border-line">
        {rows.map((r) => {
          const on = chosen.has(r.id);
          const disabled = r.locked || (!on && full);
          return (
            <li key={r.id} className="border-b border-line last:border-b-0">
              <label className={`flex items-center gap-3 px-4 py-3 ${disabled ? "" : "cursor-pointer hover:bg-tint"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onToggle(r.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-semibold ${on ? "text-ink" : "text-ink-soft"}`}>{r.label}</span>
                  <span className="block truncate text-xs text-ink-soft">{r.meta}</span>
                </span>
                <Badge tone={on ? "success" : off === "Read-only" ? "warning" : "neutral"}>{on ? "Stays on" : off}</Badge>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Choose what stays active" — for a workspace running more than its plan
 * includes. It starts from what's on now, trimmed to the plan in the order
 * things were set up; the owner can't be unticked. Nothing is deleted: campaigns
 * left out pause, inboxes stop sending, people go read-only.
 */
export function KeepActiveDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { data, mutate } = useSWR<Data>(open ? "/api/billing/keep-active" : null);
  const [campaigns, setCampaigns] = useState<Set<string>>(new Set());
  const [inboxes, setInboxes] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const running = data.campaigns.filter((c) => c.status === "active");
    setCampaigns(new Set(running.slice(0, data.limits.campaigns).map((c) => c.id)));
    setInboxes(new Set(data.inboxes.filter((i) => i.active).slice(0, data.limits.inboxes).map((i) => i.id)));
    const owner = data.people.find((p) => p.role === "owner");
    const others = data.people.filter((p) => p.active && p.role !== "owner");
    setPeople(new Set([...(owner ? [owner.id] : []), ...others.slice(0, Math.max(0, data.limits.users - (owner ? 1 : 0))).map((p) => p.id)]));
  }, [data]);

  const toggle = (set: Set<string>, update: (next: Set<string>) => void) => (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/billing/keep-active", {
        body: { campaignIds: [...campaigns], inboxIds: [...inboxes], memberIds: [...people] },
      });
      await mutate();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const running = data?.campaigns.filter((c) => c.status === "active") ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Choose what stays active"
      description={
        data?.plan
          ? `You're on ${data.plan.name}, which includes ${plural(data.limits.campaigns, "running campaign")}, ${plural(data.limits.inboxes, "sending inbox", "sending inboxes")} and ${plural(data.limits.users, "person", "people")}. Pick what stays on; the rest pause. Nothing is deleted, and upgrading turns it straight back on.`
          : "Choose a plan first — then pick what stays active on it."
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Link href="/pricing" className="btn btn-ghost !px-4 !py-2 text-sm">
            Upgrade instead
          </Link>
          <Button size="sm" loading={busy} disabled={!data?.plan} onClick={save}>
            Keep these active
          </Button>
        </div>
      }
    >
      {!data ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <>
          <Section
            title="Campaigns"
            limit={data.limits.campaigns}
            chosen={campaigns}
            onToggle={toggle(campaigns, setCampaigns)}
            off="Pauses"
            rows={running.map((c) => ({ id: c.id, label: c.name, meta: "Running · pauses where each lead is up to if left out" }))}
          />
          <Section
            title="Sending inboxes"
            limit={data.limits.inboxes}
            chosen={inboxes}
            onToggle={toggle(inboxes, setInboxes)}
            off="Stops sending"
            rows={data.inboxes.map((i) => ({
              id: i.id,
              label: i.email,
              meta: `${PROVIDERS[i.provider] ?? i.provider} · keeps receiving replies either way`,
            }))}
          />
          <Section
            title="People"
            limit={data.limits.users}
            chosen={people}
            onToggle={toggle(people, setPeople)}
            off="Read-only"
            rows={data.people.map((p) => ({
              id: p.id,
              label: `${p.name} · ${roleLabel(p.role)}`,
              meta: p.role === "owner" ? "The owner always stays active" : "Can still see everything, but can't send or change anything",
              locked: p.role === "owner",
            }))}
          />
          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </>
      )}
    </Dialog>
  );
}
