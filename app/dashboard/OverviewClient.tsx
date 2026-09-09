"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  UserPlus, CalendarClock, Reply, AlertTriangle, ArrowRight, MessageSquare,
  Mail, Linkedin, CheckCircle2, type LucideIcon,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { Badge, Banner, DashHeader, Panel, Skeleton } from "@/components/ui";
import { ActivationChecklist } from "@/components/dashboard/ActivationChecklist";
import { TeamPerformance } from "@/components/dashboard/TeamPerformance";
import { tourTarget } from "@/components/dashboard/tour/target";

type Attention = {
  pipelineItemId: string;
  lead: { id: string; firstName: string | null; lastName: string | null; email: string | null; company: string | null };
  stage: string;
  owner: { id: string; name: string; email: string } | null;
  lastEvent: { channel: string; direction: string; preview: string; occurredAt: string } | null;
  awaitingReply: boolean;
};
type Task = {
  id: string; leadId: string | null; title: string; dueAt: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; email: string | null; company: string | null } | null;
};
type Home = {
  counts: { newLeads: number; followUpsDue: number; unreadReplies: number; overdueItems: number; unassigned: number };
  attention: Attention[];
  followUps: Task[];
  leadsBySource: { label: string; count: number }[];
  pipeline: { name: string; value: number; stages: { name: string; kind: string; count: number }[] } | null;
};

const CHANNEL_ICON: Record<string, LucideIcon> = { email: Mail, whatsapp: MessageSquare, linkedin: Linkedin };

/**
 * Time-of-day greeting, resolved after mount.
 *
 * `new Date().getHours()` during SSR reads the *server's* clock — a UTC function
 * and a user in IST disagree for half the day, which is a hydration mismatch on
 * the page title. The first paint uses a time-agnostic greeting instead, so the
 * server and client always render the same thing.
 */
function useGreeting() {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  if (hour === null) return "Hi";
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const nameOf = (l: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed lead";

function ago(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Home is a work queue, not a scoreboard.
 *
 * The old overview showed four lifetime counters, which answer "how are we doing"
 * — a question nobody opens a CRM at 9am to ask. This answers "what needs me",
 * and every row is a link into the thing that needs doing. Analytics live on Reports.
 */
export default function Overview({ checklistDismissed = false }: { checklistDismissed?: boolean }) {
  // Whose dashboard we are looking at. Null is "everyone I can see", which for a
  // team member is already just their own book — so this control only ever
  // appears for someone with more than one person under them.
  const [viewAs, setViewAs] = useState<string | null>(null);
  const { data: home, error, isLoading } = useSWR<Home>(viewAs ? `/api/home?member=${viewAs}` : "/api/home");
  const { data: session } = useSession();
  const greeting = useGreeting();
  const err = error ? (error as Error).message : null;

  const firstName = (session?.user?.name ?? "").trim().split(/\s+/)[0] || null;
  const c = home?.counts;
  const total = c ? c.newLeads + c.followUpsDue + c.unreadReplies + c.overdueItems : 0;

  const tiles: { label: string; value: number | undefined; icon: LucideIcon; href: string; tone: "danger" | "accent" | "neutral" }[] = [
    { label: "New leads", value: c?.newLeads, icon: UserPlus, href: "/dashboard/leads", tone: "accent" },
    { label: "Follow-ups due", value: c?.followUpsDue, icon: CalendarClock, href: "/dashboard/tasks", tone: c?.followUpsDue ? "danger" : "neutral" },
    { label: "New replies", value: c?.unreadReplies, icon: Reply, href: "/dashboard/inbox", tone: c?.unreadReplies ? "accent" : "neutral" },
    { label: "Overdue in pipeline", value: c?.overdueItems, icon: AlertTriangle, href: "/dashboard/ageing", tone: c?.overdueItems ? "danger" : "neutral" },
  ];

  // Only appears when there is something to see, and only for the roles that
  // can. A rep never has unassigned contacts in scope, so a permanent zero tile
  // would be furniture; for an owner a non-zero count means a rule is not doing
  // its job, which is worth interrupting for.
  if (c?.unassigned) {
    tiles.push({
      label: "Unassigned",
      value: c.unassigned,
      icon: UserPlus,
      href: "/dashboard/leads?view=unassigned",
      tone: "danger",
    });
  }

  return (
    <>
      <DashHeader
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        subtitle={
          isLoading
            ? "Working out what needs you…"
            : total === 0
              ? "Nothing needs you right now."
              : `${total} thing${total === 1 ? "" : "s"} need your attention.`
        }
      />

      <div className="space-y-6 p-8">
        {err && <Banner kind="error">Couldn&apos;t load your day: {err}. Reload to try again.</Banner>}

        {/* Counters double as the entry points to the work they're counting. */}
        <div {...tourTarget("overview-stats")} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="group">
              <Panel className="h-full transition-colors group-hover:border-ink">
                <t.icon className={cn("mb-3 h-5 w-5", t.tone === "danger" ? "text-danger" : "text-ink-soft")} />
                {isLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <div className={cn("font-display text-3xl font-extrabold tabular-nums", t.tone === "danger" && t.value ? "text-danger" : "")}>
                    {t.value?.toLocaleString() ?? "—"}
                  </div>
                )}
                <div className="mt-0.5 font-mono text-xs uppercase tracking-wide text-ink-soft">{t.label}</div>
              </Panel>
            </Link>
          ))}
        </div>

        <TeamPerformance viewAs={viewAs} onViewAs={setViewAs} />

        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {/* ---- Needs your attention ---- */}
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-bold">Needs your attention</h2>
                <Link href="/dashboard/control-tower" className="font-mono text-[10px] uppercase tracking-wide text-ink-faint hover:text-ink">
                  Control tower
                </Link>
              </div>
              <Panel className="!p-0">
                {isLoading ? (
                  <div className="space-y-2 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : (home?.attention ?? []).length === 0 ? (
                  <p className="flex items-center gap-2 px-5 py-8 text-sm text-ink-soft">
                    <CheckCircle2 className="h-4 w-4 text-success" /> Every conversation has been answered.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {home!.attention.map((a) => {
                      const Icon = a.lastEvent ? (CHANNEL_ICON[a.lastEvent.channel] ?? MessageSquare) : MessageSquare;
                      return (
                        <li key={a.pipelineItemId}>
                          <Link href={`/dashboard/leads/${a.lead.id}`} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-tint">
                            <span className={cn(
                              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                              a.awaitingReply ? "bg-danger-soft text-danger-strong" : "bg-tint text-ink-soft",
                            )}>
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-semibold">
                                  {nameOf(a.lead)}
                                  {a.lead.company && <span className="font-normal text-ink-soft"> · {a.lead.company}</span>}
                                </span>
                                {a.lastEvent && <span suppressHydrationWarning className="shrink-0 font-mono text-[10px] text-ink-faint">{ago(a.lastEvent.occurredAt)}</span>}
                              </div>
                              {a.lastEvent?.preview && <p className="truncate text-xs text-ink-soft">{a.lastEvent.preview}</p>}
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <Badge tone={a.awaitingReply ? "danger" : "neutral"}>{a.awaitingReply ? "Awaiting reply" : a.stage}</Badge>
                                {a.owner && <span className="font-mono text-[10px] uppercase text-ink-faint">{a.owner.name}</span>}
                              </div>
                            </div>
                            <ArrowRight className="mt-1.5 h-4 w-4 shrink-0 text-ink-faint" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </section>

            {/* ---- Follow-ups due ---- */}
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-bold">Follow-ups due</h2>
                <Link href="/dashboard/tasks" className="font-mono text-[10px] uppercase tracking-wide text-ink-faint hover:text-ink">All tasks</Link>
              </div>
              <Panel className="!p-0">
                {isLoading ? (
                  <div className="space-y-2 p-5">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : (home?.followUps ?? []).length === 0 ? (
                  <p className="px-5 py-8 text-sm text-ink-soft">Nothing due today.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {home!.followUps.map((t) => {
                      const overdue = !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
                      return (
                        <li key={t.id}>
                          <Link
                            href={t.leadId ? `/dashboard/leads/${t.leadId}` : "/dashboard/tasks"}
                            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-tint"
                          >
                            <CalendarClock className={cn("h-4 w-4 shrink-0", overdue ? "text-danger" : "text-ink-faint")} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm">{t.title}</div>
                              {t.lead && <div className="truncate font-mono text-[10px] uppercase text-ink-faint">{nameOf(t.lead)}</div>}
                            </div>
                            {overdue && <Badge tone="danger">Overdue</Badge>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </section>
          </div>

          {/* ---- Right rail ---- */}
          <div className="space-y-6">
            <Panel>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Pipeline</h2>
                <Link href="/dashboard/pipeline" className="font-mono text-[10px] uppercase tracking-wide text-ink-faint hover:text-ink">Open</Link>
              </div>
              {home?.pipeline ? (
                <>
                  <div className="mt-2 font-display text-2xl font-extrabold tabular-nums">
                    ₹{home.pipeline.value.toLocaleString("en-IN")}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">open value · {home.pipeline.name}</div>
                  <ul className="mt-4 space-y-1.5">
                    {home.pipeline.stages.filter((s) => s.kind === "open").map((s) => (
                      <li key={s.name} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-ink-soft">{s.name}</span>
                        <span className="font-mono text-xs tabular-nums">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-sm text-ink-soft">No pipeline yet.</p>
              )}
            </Panel>

            <Panel>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Today&apos;s leads</h2>
                <Link href="/dashboard/leads" className="font-mono text-[10px] uppercase tracking-wide text-ink-faint hover:text-ink">All</Link>
              </div>
              {(home?.leadsBySource ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-ink-soft">None yet today.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {home!.leadsBySource.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-ink-soft">{s.label}</span>
                      <span className="font-mono text-xs tabular-nums">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <ActivationChecklist dismissed={checklistDismissed} />
      </div>
    </>
  );
}
