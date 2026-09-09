"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowLeft, Mail, MessageSquare, Linkedin, Phone, Building2, Tag, Check, Clock,
  AlertTriangle, StickyNote, GitBranch, Rocket, Plus, Trash2, CircleDot, Send,
  ArrowDownLeft, ArrowUpRight, Sparkles, Pencil, type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/client";
import { TaskDialog } from "@/components/dashboard/TaskDialog";
import { cn } from "@/lib/cn";
import { Badge, Banner, Panel, Skeleton, Textarea, Select, useConfirm, usePrompt, useToast } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Types — mirror lib/queries.ts getLeadDetail / getLeadTimeline        */
/* ------------------------------------------------------------------ */

type Identity = { id: string; kind: string; value: string; source: string | null };
type Task = { id: string; title: string; kind: string; dueAt: string | null; ownerId: string | null; createdKind: string };
type Stage = { id: string; name: string; kind: string };
type Item = {
  id: string;
  value: number | null;
  ownerId: string | null;
  enteredStageAt: string;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  stage: Stage;
  pipeline: { id: string; name: string; department: string; stages: Stage[] };
};
type NextAction = { taskId: string | null; label: string; kind: string; dueAt: string | null; urgent: boolean; source: string };
type Lead = {
  id: string;
  firstName: string | null; lastName: string | null; title: string | null; company: string | null;
  email: string | null; phone: string | null; linkedinUrl: string | null;
  stage: string; tags: string[]; score: number | null; optedOut: boolean;
  budgetMentioned: boolean | null; timelineMentioned: boolean | null; decisionMakerConfirmed: boolean | null;
  createdAt: string;
  contactIdentities: Identity[];
  leadSource: { id: string; key: string; label: string } | null;
  tasks: Task[];
  pipelineItems: Item[];
  enrollments: { id: string; status: string; nextRunAt: string | null; campaign: { id: string; name: string } }[];
  owners: { id: string; name: string; email: string }[];
  nextAction: NextAction | null;
};
type Entry = {
  id: string; at: string; kind: string; channel: string | null; direction: string | null;
  title: string; body: string | null; actor: string | null;
};

const fullName = (l: Lead) => [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed lead";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Timestamps are formatted in the *viewer's* locale and timezone, which the server
 * cannot know — so the server's string and the browser's disagree and React reports
 * a hydration mismatch. Suppressing it on the specific text node is the sanctioned
 * fix (the browser's value is the correct one, and it wins).
 */
const localTime = { suppressHydrationWarning: true } as const;

/* ------------------------------------------------------------------ */

export default function LeadDetailClient({ id }: { id: string }) {
  const { data: lead, mutate, isLoading } = useSWR<Lead>(`/api/leads/${id}`);
  const { data: timeline = [], mutate: mutateTimeline } = useSWR<Entry[]>(`/api/leads/${id}/timeline`);
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useToast();

  async function refresh() {
    await Promise.all([mutate(), mutateTimeline()]);
  }

  if (isLoading && !lead) return <LoadingState />;
  if (!lead) return <div className="p-8"><Banner kind="error">Couldn&apos;t load this lead.</Banner></div>;

  const item = lead.pipelineItems[0] ?? null;
  const ownerName = (uid: string | null) => (uid ? lead.owners.find((o) => o.id === uid)?.name ?? null : null);

  return (
    <>
      {/* ---- Header ---- */}
      <div className="border-b border-line px-8 py-6">
        <Link href="/dashboard/leads" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Leads
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold">{fullName(lead)}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
              {lead.title && <span>{lead.title}</span>}
              {lead.title && lead.company && <span aria-hidden>·</span>}
              {lead.company && (
                <Link href={`/dashboard/companies/${encodeURIComponent(lead.company)}`} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                  <Building2 className="h-3.5 w-3.5" /> {lead.company}
                </Link>
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={item ? "accent" : "neutral"}>{item ? item.stage.name : lead.stage}</Badge>
              {item?.value != null && (
                <span className="font-display text-sm font-bold tabular-nums">₹{item.value.toLocaleString("en-IN")}</span>
              )}
              {lead.score != null && <Badge tone={lead.score >= 60 ? "success" : "neutral"}>Score {lead.score}</Badge>}
              {lead.optedOut && <Badge tone="danger">Opted out</Badge>}
              {lead.leadSource && <Badge tone="neutral">via {lead.leadSource.label}</Badge>}
            </div>
          </div>

          <ChannelActions lead={lead} />
        </div>
      </div>

      {msg && <div className="px-8 pt-4"><Banner kind="error">{msg}</Banner></div>}

      {/* ---- Next action ---- */}
      <div className="border-b border-line bg-surface-sunken px-8 py-4">
        <NextActionBand lead={lead} onChanged={refresh} onError={setMsg} />
      </div>

      {/* ---- Three columns ---- */}
      <div className="grid gap-6 p-8 xl:grid-cols-[280px_1fr_300px]">
        <ProfileColumn lead={lead} onChanged={refresh} onError={setMsg} />

        <div className="space-y-4">
          <NoteComposer
            leadId={lead.id}
            onAdded={async () => { await refresh(); toast("Note added."); }}
            onError={setMsg}
          />
          <Timeline entries={timeline} />
        </div>

        <CrmRail lead={lead} item={item} ownerName={ownerName} onChanged={refresh} onError={setMsg} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Channel actions                                                     */
/* ------------------------------------------------------------------ */

/**
 * Reach the person on whichever channel they actually have. A channel with no
 * identifier is shown disabled with the reason rather than hidden — "you can't
 * WhatsApp them because there's no number" is useful; a missing button isn't.
 */
function ChannelActions({ lead }: { lead: Lead }) {
  const waNumber = lead.phone?.replace(/[^\d]/g, "") ?? "";
  const actions: { label: string; icon: LucideIcon; href: string | null; why: string }[] = [
    { label: "Email", icon: Mail, href: lead.email ? `mailto:${lead.email}` : null, why: "No email address on this lead." },
    { label: "WhatsApp", icon: MessageSquare, href: waNumber ? `https://wa.me/${waNumber}` : null, why: "No phone number on this lead." },
    { label: "LinkedIn", icon: Linkedin, href: lead.linkedinUrl, why: "No LinkedIn profile on this lead." },
    { label: "Call", icon: Phone, href: lead.phone ? `tel:${lead.phone}` : null, why: "No phone number on this lead." },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) =>
        a.href ? (
          <a
            key={a.label}
            href={a.href}
            target={a.href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className="btn btn-ghost !py-2 !text-sm"
          >
            <a.icon className="h-4 w-4" /> {a.label}
          </a>
        ) : (
          <span
            key={a.label}
            title={a.why}
            aria-disabled
            className="btn btn-ghost !py-2 !text-sm cursor-not-allowed opacity-40"
          >
            <a.icon className="h-4 w-4" /> {a.label}
          </span>
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Next action                                                         */
/* ------------------------------------------------------------------ */

function NextActionBand({
  lead, onChanged, onError,
}: { lead: Lead; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const toast = useToast();
  const na = lead.nextAction;

  // Work should stay with whoever owns the deal. Creating a follow-up on a
  // colleague's lead used to silently assign it to whoever clicked — the
  // automated reply-follow-up path already gets this right.
  const dealOwnerId = lead.pipelineItems[0]?.ownerId ?? null;
  // Editing needs the task's current values, and `nextAction` only carries a
  // label; the full row is already on the lead.
  const backingTask = na?.taskId ? lead.tasks.find((t) => t.id === na.taskId) ?? null : null;

  async function complete() {
    if (!na?.taskId) return;
    setBusy(true); onError(null);
    try {
      await api("/api/tasks", { method: "PATCH", body: { id: na.taskId, action: "complete" } });
      await onChanged();
      toast("Done.");
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  const taskDialog = (
    <TaskDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      onSaved={() => {
        onChanged();
        toast(backingTask ? "Task updated." : "Follow-up created.");
      }}
      mode={backingTask ? "edit" : "create"}
      taskId={backingTask?.id}
      initial={
        backingTask
          ? {
              title: backingTask.title,
              dueAt: backingTask.dueAt,
              ownerId: backingTask.ownerId,
              kind: backingTask.kind as never,
            }
          : { title: `Follow up with ${fullName(lead)}` }
      }
      defaultOwnerId={dealOwnerId}
      fixedLeadId={lead.id}
      fixedLeadLabel={fullName(lead)}
    />
  );

  if (!na) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Next action</div>
          <div className="mt-0.5 text-sm text-ink-soft">Nothing owed right now.</div>
        </div>
        <button onClick={() => setDialogOpen(true)} disabled={busy} className="btn btn-ghost !py-2 !text-sm disabled:opacity-50">
          <Plus className="h-4 w-4" /> Create follow-up
        </button>
        {taskDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Next action</div>
        <div className={cn("mt-0.5 flex items-center gap-2 text-sm font-semibold", na.urgent && "text-danger")}>
          {na.urgent ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CircleDot className="h-4 w-4 shrink-0 text-ink-soft" />}
          {na.label}
          {/* A derived action has no row behind it — say so, so "why can't I tick this off?" has an answer. */}
          {!na.taskId && <span className="font-normal text-ink-faint">· suggested</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {na.taskId ? (
          <>
            <button onClick={() => setDialogOpen(true)} disabled={busy} className="btn btn-ghost !py-2 !text-sm disabled:opacity-50">
              <Clock className="h-4 w-4" /> Edit
            </button>
            <button onClick={complete} disabled={busy} className="btn btn-primary !py-2 !text-sm disabled:opacity-50">
              <Check className="h-4 w-4" /> Complete
            </button>
          </>
        ) : (
          <button onClick={() => setDialogOpen(true)} disabled={busy} className="btn btn-ghost !py-2 !text-sm disabled:opacity-50">
            <Plus className="h-4 w-4" /> Make it a task
          </button>
        )}
      </div>
      {taskDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

const IDENTITY_ICON: Record<string, LucideIcon> = { email: Mail, phone: Phone, linkedin: Linkedin, external: CircleDot };

function ProfileColumn({
  lead, onChanged, onError,
}: { lead: Lead; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const prompt = usePrompt();

  async function patch(data: Record<string, unknown>) {
    setBusy(true); onError(null);
    try {
      await api(`/api/leads/${lead.id}`, { method: "PATCH", body: data });
      await onChanged();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  /**
   * Editing the raw fields matters most for LinkedIn: the companion extension
   * only acts on contacts that have a profile URL, so "add the URL" has to be
   * reachable from the record itself.
   */
  async function editField(field: "email" | "phone" | "linkedinUrl", label: string, current: string | null) {
    const value = await prompt({
      title: label,
      body: field === "linkedinUrl" ? "The Chrome extension acts on this URL when it sends invites and messages." : undefined,
      label,
      defaultValue: current ?? "",
      confirmLabel: "Save",
      // Blank is meaningful — it clears the field — so accept it.
      validate: (v) =>
        !v || field !== "linkedinUrl" || /^https?:\/\/(www\.)?linkedin\.com\//i.test(v)
          ? null
          : "Enter a linkedin.com profile URL.",
    });
    if (value === null) return;
    await patch({ [field]: value || null });
  }

  const fields: { key: "email" | "phone" | "linkedinUrl"; label: string; value: string | null; icon: LucideIcon }[] = [
    { key: "email", label: "Email", value: lead.email, icon: Mail },
    { key: "phone", label: "Phone", value: lead.phone, icon: Phone },
    { key: "linkedinUrl", label: "LinkedIn", value: lead.linkedinUrl, icon: Linkedin },
  ];

  const signals: { key: "budgetMentioned" | "timelineMentioned" | "decisionMakerConfirmed"; label: string }[] = [
    { key: "budgetMentioned", label: "Budget discussed" },
    { key: "timelineMentioned", label: "Timeline known" },
    { key: "decisionMakerConfirmed", label: "Decision-maker" },
  ];

  // Identifiers the graph knows about that aren't already shown as a field above —
  // an alternate email a webhook supplied, say. Showing them twice would just be noise.
  const known = new Set(fields.map((f) => (f.value ?? "").toLowerCase()).filter(Boolean));
  const extraIdentities = lead.contactIdentities.filter(
    (i) => ![...known].some((k) => k.includes(i.value.toLowerCase()) || i.value.toLowerCase().includes(k)),
  );

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Contact</h2>
        <div className="mt-3 space-y-1 text-sm">
          {fields.map((f) => (
            <button
              key={f.key}
              disabled={busy}
              onClick={() => editField(f.key, f.label, f.value)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-tint disabled:opacity-50"
            >
              <f.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1">
                {f.value ? (
                  <span className="block truncate">{f.value}</span>
                ) : (
                  <span className="text-ink-faint">Add {f.label.toLowerCase()}</span>
                )}
              </span>
              <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" />
            </button>
          ))}
        </div>

        {extraIdentities.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">Also known as</div>
            <ul className="mt-1.5 space-y-1.5">
              {extraIdentities.map((i) => {
                const Icon = IDENTITY_ICON[i.kind] ?? CircleDot;
                return (
                  <li key={i.id} className="flex items-start gap-2 text-sm">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    <div className="min-w-0">
                      <div className="truncate">{i.value}</div>
                      {i.source && <div className="font-mono text-[10px] uppercase text-ink-faint">from {i.source}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p {...localTime} className="mt-3 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
          Added {new Date(lead.createdAt).toLocaleDateString()}
        </p>
      </Panel>

      <Panel>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Qualification</h2>
        <p className="mt-1 text-xs text-ink-soft">These drive the score. The agent sets them from conversations too.</p>
        <div className="mt-3 space-y-1.5">
          {signals.map((s) => {
            const on = lead[s.key] === true;
            return (
              <button
                key={s.key}
                disabled={busy}
                onClick={() => patch({ [s.key]: !on })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50",
                  on ? "bg-success-soft text-success-strong" : "text-ink-soft hover:bg-tint hover:text-ink",
                )}
              >
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-success-strong bg-success-strong text-on-solid" : "border-line")}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>
      </Panel>

      {lead.tags.length > 0 && (
        <Panel>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Tags</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lead.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-xs">
                <Tag className="h-3 w-3" /> {t}
              </span>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

const KIND_ICON: Record<string, LucideIcon> = {
  message: Send, activity: Sparkles, stage: GitBranch, note: StickyNote, task: Check,
};

/** One history, whatever produced it. The row never says which table it came from. */
function Timeline({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <Panel>
        <p className="py-6 text-center text-sm text-ink-soft">
          Nothing has happened yet. Messages, stage moves and notes all land here.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="!p-0">
      <ul className="divide-y divide-line">
        {entries.map((e) => {
          const Icon = e.direction === "inbound" ? ArrowDownLeft : e.kind === "message" ? ArrowUpRight : (KIND_ICON[e.kind] ?? CircleDot);
          return (
            <li key={e.id} className="flex gap-3 px-5 py-3.5">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  e.direction === "inbound" ? "bg-success-soft text-success-strong" : "bg-tint text-ink-soft",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold capitalize">{e.title}</span>
                  <span {...localTime} className="font-mono text-[10px] text-ink-faint">{when(e.at)}</span>
                </div>
                {e.body && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">
                    {e.body.replace(/<[^>]+>/g, " ").slice(0, 600)}
                  </p>
                )}
                {e.actor && <div className="mt-1 font-mono text-[10px] uppercase text-ink-faint">by {e.actor}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function NoteComposer({
  leadId, onAdded, onError,
}: { leadId: string; onAdded: () => Promise<void>; onError: (m: string | null) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!body.trim()) return;
    setBusy(true); onError(null);
    try {
      await api("/api/notes", { body: { leadId, body: body.trim() } });
      setBody("");
      await onAdded();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Panel className="!p-4">
      <Textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a note…"
        // Cmd/Ctrl+Enter saves — the note box is used constantly and reaching for
        // the mouse every time is the difference between notes and no notes.
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">Internal — never sent</span>
        <button onClick={save} disabled={busy || !body.trim()} className="btn btn-primary !py-1.5 !text-xs disabled:opacity-40">
          <StickyNote className="h-3.5 w-3.5" /> Add note
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* CRM rail                                                            */
/* ------------------------------------------------------------------ */

function CrmRail({
  lead, item, ownerName, onChanged, onError,
}: {
  lead: Lead;
  item: Item | null;
  ownerName: (uid: string | null) => string | null;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const prompt = usePrompt();
  const confirm = useConfirm();
  const toast = useToast();

  async function moveStage(toStageId: string) {
    if (!item || toStageId === item.stage.id) return;
    const stages = item.pipeline.stages;
    const backward = stages.findIndex((s) => s.id === toStageId) < stages.findIndex((s) => s.id === item.stage.id);

    let reason: string | null = null;
    if (backward) {
      reason = await prompt({
        title: "Moving backwards",
        body: "Going back a stage is recorded on this contact's timeline.",
        label: "Why?",
        placeholder: "Budget fell through, needs re-qualifying…",
        confirmLabel: "Move back",
      });
      if (!reason) return;
    }

    setBusy(true); onError(null);
    try {
      await api("/api/pipeline-items", { method: "PATCH", body: { itemId: item.id, toStageId, reason } });
      await onChanged();
      toast("Stage updated.");
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function completeTask(taskId: string) {
    setBusy(true); onError(null);
    try {
      await api("/api/tasks", { method: "PATCH", body: { id: taskId, action: "complete" } });
      await onChanged();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function removeTask(taskId: string) {
    if (!(await confirm({ title: "Delete this task?", confirmLabel: "Delete", tone: "danger" }))) return;
    setBusy(true); onError(null);
    try {
      await api(`/api/tasks?id=${taskId}`, { method: "DELETE" });
      await onChanged();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Pipeline</h2>
        {item ? (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <Label>Stage</Label>
              <Select value={item.stage.id} disabled={busy} onChange={(e) => moveStage(e.target.value)} className="!py-2 !text-sm">
                {item.pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <Row label="Pipeline" value={item.pipeline.name} />
            <Row label="Owner" value={ownerName(item.ownerId) ?? "Unassigned"} />
            <Row label="Value" value={item.value != null ? `₹${item.value.toLocaleString("en-IN")}` : "—"} />
            <Row label="In stage since" value={new Date(item.enteredStageAt).toLocaleDateString()} localTime />
            {item.slaBreachedAt && (
              <p className="flex items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs text-warning-strong">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Past its stage SLA
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            Not in a pipeline. Contacts join one automatically as leads arrive from a source.
          </p>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Open tasks</h2>
          <Link href="/dashboard/tasks" className="font-mono text-[10px] uppercase tracking-wide text-ink-faint hover:text-ink">All</Link>
        </div>
        {lead.tasks.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Nothing scheduled.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {lead.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-sm">
                <button
                  onClick={() => completeTask(t.id)}
                  disabled={busy}
                  aria-label={`Complete ${t.title}`}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border border-line transition-colors hover:border-success-strong hover:bg-success-soft disabled:opacity-40"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t.title}</div>
                  <div {...localTime} className="font-mono text-[10px] uppercase text-ink-faint">
                    {t.dueAt ? new Date(t.dueAt).toLocaleDateString() : "No date"}
                    {t.createdKind === "system" && " · auto"}
                  </div>
                </div>
                <button onClick={() => removeTask(t.id)} disabled={busy} aria-label="Delete task" className="text-ink-faint hover:text-danger disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {lead.enrollments.length > 0 && (
        <Panel>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Sequences</h2>
          <ul className="mt-3 space-y-2">
            {lead.enrollments.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-sm">
                <Rocket className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <Link href="/dashboard/campaigns" className="min-w-0 flex-1 truncate hover:underline">{e.campaign.name}</Link>
                <Badge tone={e.status === "active" ? "accent" : "neutral"}>{e.status}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value, localTime: isTime }: { label: string; value: string; localTime?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span suppressHydrationWarning={isTime} className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">{children}</div>;
}

function LoadingState() {
  return (
    <div className="p-8">
      <Skeleton className="h-8 w-56" />
      <div className="mt-6 grid gap-6 xl:grid-cols-[280px_1fr_300px]">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
