"use client";

import useSWR from "swr";
import Link from "next/link";
import { Bell, CheckCircle2, ListChecks, Mail, MessageSquareOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { DashHeader, Panel, EmptyState, Skeleton, Badge } from "@/components/ui";

type EscalationRow = {
  id: string;
  level: number;
  channel: string;
  sentAt: string;
  meta: { channels?: string[]; reason?: string } | null;
  to: { id: string; name: string; email: string } | null;
  // Exactly one of these is set: a breached pipeline stage, or an overdue task.
  item: {
    id: string;
    lead: { id: string; firstName: string | null; lastName: string | null; email: string | null };
    stage: { name: string };
    pipeline: { id: string; name: string; department: string };
  } | null;
  task: {
    id: string;
    title: string;
    dueAt: string | null;
    leadId: string | null;
    lead: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  } | null;
};

function personName(l: { firstName: string | null; lastName: string | null; email: string | null } | null) {
  if (!l) return null;
  return [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed";
}

const LEVEL_LABEL: Record<number, string> = { 1: "Owner", 2: "Manager", 3: "Admin" };

export default function EscalationsClient() {
  const { data, isLoading } = useSWR<EscalationRow[]>("/api/escalations");
  const events = data ?? [];
  const delivered = events.filter((e) => (e.meta?.channels?.length ?? 0) > 0).length;

  return (
    <>
      <DashHeader
        title="Escalations"
        subtitle="Every SLA breach that's been raised, who it went to, and whether delivery actually happened."
      />

      <div className="space-y-6 p-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Bell className="mb-3 h-5 w-5 text-ink-soft" />
            {isLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <div className="font-display text-3xl font-extrabold tabular-nums">{events.length}</div>
            )}
            <div className="mt-0.5 font-mono text-xs uppercase tracking-wide text-ink-soft">Total escalations</div>
          </Panel>
          <Panel>
            <Mail className="mb-3 h-5 w-5 text-ink-soft" />
            {isLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <div className="font-display text-3xl font-extrabold tabular-nums">{delivered}</div>
            )}
            <div className="mt-0.5 font-mono text-xs uppercase tracking-wide text-ink-soft">Actually delivered</div>
          </Panel>
        </div>

        {isLoading && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 border-b border-line px-4 py-3.5 last:border-0">
                <Skeleton className="h-3.5 max-w-[26%] flex-1" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 flex-1" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && events.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title="No escalations yet"
            body="Nothing has breached its SLA and been raised up the reporting line. This fills in the moment one does."
          />
        )}

        {!isLoading && events.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">What is late</th>
                  <th className="px-4 py-3 font-medium">Escalated to</th>
                  <th className="px-4 py-3 font-medium">Delivery</th>
                  <th className="px-4 py-3 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((e) => {
                  const lead = e.item?.lead ?? e.task?.lead ?? null;
                  const name = personName(lead) ?? "—";
                  const leadId = e.item?.lead.id ?? e.task?.leadId ?? null;
                  const channels = e.meta?.channels ?? [];
                  return (
                    <tr key={e.id}>
                      <td className="px-4 py-3">
                        {leadId ? (
                          <Link href={`/dashboard/leads/${leadId}`} className="font-medium hover:text-accent">
                            {name}
                          </Link>
                        ) : (
                          <span className="text-ink-soft">{name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {e.item ? (
                          <>
                            <span className="capitalize">{e.item.pipeline.department}</span> · {e.item.stage.name}
                          </>
                        ) : e.task ? (
                          <span className="inline-flex items-center gap-1.5">
                            <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate">{e.task.title}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{e.to?.name ?? "—"}</div>
                        <div className="text-xs text-ink-soft">{LEVEL_LABEL[e.level] ?? `Level ${e.level}`}</div>
                      </td>
                      <td className="px-4 py-3">
                        {channels.length > 0 ? (
                          <Badge tone="success">
                            <Mail className="h-3 w-3" /> Emailed
                          </Badge>
                        ) : (
                          <Badge tone="neutral">
                            <MessageSquareOff className="h-3 w-3" /> {e.meta?.reason ?? "Not delivered"}
                          </Badge>
                        )}
                      </td>
                      <td className={cn("px-4 py-3 text-right font-mono text-xs text-ink-soft")}>
                        {new Date(e.sentAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
