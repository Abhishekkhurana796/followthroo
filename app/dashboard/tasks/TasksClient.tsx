"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ListChecks, Check, Mail, MessageSquare, Linkedin, Phone, Video, CalendarClock,
  Plus, Trash2, RotateCcw, Pencil, type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/cn";
import { Badge, Banner, DashHeader, EmptyState, Panel, Skeleton, useConfirm, useToast } from "@/components/ui";
import { TaskDialog } from "@/components/dashboard/TaskDialog";

type Task = {
  id: string;
  leadId: string | null;
  title: string;
  kind: string;
  status: string;
  dueAt: string | null;
  createdKind: string;
  completedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  priority: string;
  instruction: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; email: string | null; company: string | null } | null;
};
type Buckets = { overdue: Task[]; today: Task[]; upcoming: Task[]; done: Task[] };

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-info",
  medium: "bg-warning",
  high: "bg-danger",
};

const KIND_ICON: Record<string, LucideIcon> = {
  email: Mail, whatsapp: MessageSquare, linkedin: Linkedin, call: Phone, meeting: Video, follow_up: CalendarClock,
};

const SECTIONS = [
  { key: "overdue", label: "Overdue", tone: "danger" as const, blurb: "Past due. These are the ones that lose deals." },
  { key: "today", label: "Today", tone: "accent" as const, blurb: "Due today, plus anything with no date." },
  { key: "upcoming", label: "Upcoming", tone: "neutral" as const, blurb: "Scheduled for later." },
  { key: "done", label: "Recently done", tone: "success" as const, blurb: "The last 25 you closed out." },
] as const;

function leadName(t: Task) {
  if (!t.lead) return null;
  return [t.lead.firstName, t.lead.lastName].filter(Boolean).join(" ") || t.lead.email || "Unnamed lead";
}

export default function TasksClient() {
  const [mine, setMine] = useState(false);
  const key = `/api/tasks?view=buckets${mine ? "&mine=1" : ""}`;
  const { data, isLoading, mutate } = useSWR<Buckets>(key);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  async function act(id: string, action: "complete" | "reopen") {
    setBusy(id); setMsg(null);
    try {
      await api("/api/tasks", { method: "PATCH", body: { id, action } });
      await mutate();
      toast(action === "complete" ? "Done." : "Reopened.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete this task?", confirmLabel: "Delete", tone: "danger" }))) return;
    setBusy(id); setMsg(null);
    try {
      await api(`/api/tasks?id=${id}`, { method: "DELETE" });
      await mutate();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  }

  // Editing reuses the same dialog; `editing` null means create.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(t: Task) {
    setEditing(t);
    setDialogOpen(true);
  }

  const total = data ? data.overdue.length + data.today.length + data.upcoming.length : 0;
  const empty = !isLoading && data && total === 0 && data.done.length === 0;

  return (
    <>
      <DashHeader
        title="Tasks"
        subtitle={isLoading ? "Loading…" : `${total} open`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-line p-1">
              <button
                onClick={() => setMine(false)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition", !mine ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint")}
              >
                Everyone
              </button>
              <button
                onClick={() => setMine(true)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition", mine ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint")}
              >
                Mine
              </button>
            </div>
            <button onClick={openCreate} className="btn btn-primary !py-2 !text-sm">
              <Plus className="h-4 w-4" /> New task
            </button>
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {msg && <Banner kind="error">{msg}</Banner>}

        {isLoading && !data && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
          </div>
        )}

        {empty && (
          <EmptyState
            icon={ListChecks}
            title="Nothing to chase"
            body="Follow-ups appear here automatically when someone replies and nobody has answered yet — and you can schedule your own from any lead."
            action={<button onClick={openCreate} className="btn btn-primary"><Plus className="h-4 w-4" /> New task</button>}
          />
        )}

        {data && !empty && SECTIONS.map((section) => {
          const items = data[section.key];
          if (items.length === 0) return null;
          return (
            <section key={section.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="font-display text-lg font-bold">{section.label}</h2>
                <Badge tone={section.tone}>{items.length}</Badge>
                <span className="text-xs text-ink-soft">{section.blurb}</span>
              </div>
              <Panel className="!p-0">
                <ul className="divide-y divide-line">
                  {items.map((t) => {
                    const Icon = KIND_ICON[t.kind] ?? CalendarClock;
                    const who = leadName(t);
                    const done = t.status === "done";
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                        <button
                          onClick={() => act(t.id, done ? "reopen" : "complete")}
                          disabled={busy === t.id}
                          aria-label={done ? `Reopen ${t.title}` : `Complete ${t.title}`}
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40",
                            done ? "border-success-strong bg-success-strong text-on-solid" : "border-line hover:border-success-strong hover:bg-success-soft",
                          )}
                        >
                          {done && <Check className="h-3 w-3" />}
                        </button>

                        {PRIORITY_DOT[t.priority] && (
                          <span
                            className={cn("h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[t.priority])}
                            title={`${t.priority} priority`}
                          />
                        )}

                        <Icon className="h-4 w-4 shrink-0 text-ink-faint" />

                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate text-sm font-medium", done && "text-ink-soft line-through")}>{t.title}</div>
                          {/* Locale/timezone formatting differs between server and browser;
                              the browser's rendering is the correct one. */}
                          <div suppressHydrationWarning className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                            {who && t.leadId && (
                              <Link href={`/dashboard/leads/${t.leadId}`} className="hover:text-accent hover:underline">
                                {who}{t.lead?.company ? ` · ${t.lead.company}` : ""}
                              </Link>
                            )}
                            {t.dueAt && <span>{new Date(t.dueAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
                            {!mine && <span>{t.ownerName ?? "unassigned"}</span>}
                            {t.createdKind === "system" && <span>auto</span>}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {t.leadId && (
                            <Link href={`/dashboard/leads/${t.leadId}`} className="btn btn-ghost !px-2.5 !py-1.5 !text-xs">
                              Do it
                            </Link>
                          )}
                          {!done && (
                            <button onClick={() => openEdit(t)} aria-label={`Edit ${t.title}`} className="p-1.5 text-ink-faint hover:text-ink">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {done && (
                            <button onClick={() => act(t.id, "reopen")} disabled={busy === t.id} aria-label="Reopen" className="p-1.5 text-ink-faint hover:text-ink disabled:opacity-40">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => remove(t.id)} disabled={busy === t.id} aria-label="Delete task" className="p-1.5 text-ink-faint hover:text-danger disabled:opacity-40">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </section>
          );
        })}
      </div>

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          mutate();
          toast(editing ? "Task updated." : "Task created.");
        }}
        mode={editing ? "edit" : "create"}
        taskId={editing?.id}
        initial={
          editing
            ? {
                title: editing.title,
                instruction: editing.instruction,
                dueAt: editing.dueAt,
                ownerId: editing.ownerId,
                kind: editing.kind as never,
                priority: editing.priority as never,
              }
            : undefined
        }
        fixedLeadId={editing?.leadId ?? undefined}
        fixedLeadLabel={editing ? leadName(editing) : undefined}
      />
    </>
  );
}
