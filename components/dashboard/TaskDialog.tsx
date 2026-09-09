"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarClock, Check, Loader2 } from "lucide-react";
import { Banner, Button, Dialog, Input, Label, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client";
import { LeadPicker, leadLabel } from "@/components/dashboard/LeadPicker";

export type TaskKindValue =
  | "follow_up"
  | "call"
  | "email"
  | "whatsapp"
  | "linkedin"
  | "meeting"
  | "other";

const KINDS: { value: TaskKindValue; label: string }[] = [
  { value: "follow_up", label: "Follow-up" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

type Assignees = {
  self: string;
  members: {
    userId: string;
    name: string;
    email: string | null;
    department: string | null;
    isSelf: boolean;
  }[];
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Default: tomorrow at 9am.
 *
 * The old create flow hardcoded "now", which meant every task was born already
 * due and Today became a list of everything ever created. A task you write at
 * 4pm is almost never a task due at 4pm.
 */
function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function todayEvening(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  // Already past 5pm? "Today" should still mean a time that has not happened.
  if (d.getTime() <= Date.now()) d.setTime(Date.now() + 60 * 60_000);
  return d;
}

function nextWeek(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  return d;
}

type Preset = "today" | "tomorrow" | "next_week" | "none" | "custom";

const PRESETS: { key: Preset; label: string; make: () => Date | null }[] = [
  { key: "today", label: "Today", make: todayEvening },
  { key: "tomorrow", label: "Tomorrow", make: tomorrowMorning },
  { key: "next_week", label: "Next week", make: nextWeek },
  { key: "none", label: "No date", make: () => null },
];

/** datetime-local wants local wall-clock, not an ISO instant. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type TaskPriorityValue = "none" | "low" | "medium" | "high";

/** Dot colour per level — the label carries the meaning, the dot only reinforces it. */
const PRIORITIES: { value: TaskPriorityValue; label: string; dot: string }[] = [
  { value: "none", label: "None", dot: "bg-line-strong" },
  { value: "low", label: "Low", dot: "bg-info" },
  { value: "medium", label: "Medium", dot: "bg-warning" },
  { value: "high", label: "High", dot: "bg-danger" },
];

export type TaskDraft = {
  title: string;
  instruction: string | null;
  dueAt: string | null;
  ownerId: string | null;
  kind: TaskKindValue;
  priority: TaskPriorityValue;
  leadId: string | null;
};

/**
 * Create or edit a task.
 *
 * Replaces a single-line text prompt that could set nothing but a title — which
 * is why every task in the system was a follow-up, due immediately, and owned by
 * whoever happened to click the button.
 */
export function TaskDialog({
  open,
  onClose,
  onSaved,
  mode = "create",
  initial,
  /** Pre-selects the owner, so work stays with whoever owns the deal. */
  defaultOwnerId,
  /** Set when opened from a contact — the association is then fixed, not searched. */
  fixedLeadId,
  fixedLeadLabel,
  taskId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  mode?: "create" | "edit";
  initial?: Partial<TaskDraft>;
  defaultOwnerId?: string | null;
  fixedLeadId?: string | null;
  fixedLeadLabel?: string | null;
  taskId?: string;
}) {
  const { data: assignees } = useSWR<Assignees>(open ? "/api/tasks/assignees" : null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKindValue>("follow_up");
  const [priority, setPriority] = useState<TaskPriorityValue>("none");
  const [instruction, setInstruction] = useState("");
  const [preset, setPreset] = useState<Preset>("tomorrow");
  const [custom, setCustom] = useState(() => toLocalInput(tomorrowMorning()));
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadName, setLeadName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed every time it opens, so a cancelled draft never leaks into the next.
  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setKind(initial?.kind ?? "follow_up");
    setPriority(initial?.priority ?? "none");
    setInstruction(initial?.instruction ?? "");
    setError(null);
    if (initial?.dueAt) {
      setPreset("custom");
      setCustom(toLocalInput(new Date(initial.dueAt)));
    } else {
      setPreset(initial && "dueAt" in initial ? "none" : "tomorrow");
      setCustom(toLocalInput(tomorrowMorning()));
    }
    setOwnerId(initial?.ownerId ?? defaultOwnerId ?? null);
    setLeadId(fixedLeadId ?? initial?.leadId ?? null);
    setLeadName(fixedLeadLabel ?? null);
    // Only re-seed on open — `initial` is a fresh object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canChooseOwner = (assignees?.members.length ?? 0) > 1;
  const effectiveOwner = ownerId ?? assignees?.self ?? null;
  const ownerRow = assignees?.members.find((m) => m.userId === effectiveOwner) ?? null;

  const resolvedDue = useMemo(() => {
    if (preset === "custom") return custom ? new Date(custom) : null;
    return PRESETS.find((p) => p.key === preset)?.make() ?? null;
  }, [preset, custom]);

  async function save() {
    const t = title.trim();
    if (!t) {
      setError("Give it a title, so it still means something in a list next week.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dueAt = resolvedDue ? resolvedDue.toISOString() : null;
      if (mode === "edit" && taskId) {
        await api("/api/tasks", {
          method: "PATCH",
          body: {
            id: taskId,
            action: "update",
            title: t,
            instruction: instruction.trim() || null,
            kind,
            priority,
            dueAt,
            ownerId: effectiveOwner,
          },
        });
      } else {
        await api("/api/tasks", {
          body: {
            title: t,
            instruction: instruction.trim() || null,
            kind,
            priority,
            dueAt,
            ownerId: effectiveOwner,
            ...(leadId ? { leadId } : {}),
          },
        });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "edit" ? "Edit task" : "New task"}
      description={mode === "edit" ? undefined : "One owed action against one contact."}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {!busy && <Check className="h-4 w-4" aria-hidden />}
            {mode === "edit" ? "Save" : "Create task"}
          </Button>
        </>
      }
    >
      {/* Two columns: what it is on the left, what it says on the right. The
          title is the field people came to fill in, so it gets the wide half. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label htmlFor="task-kind">Type</Label>
            <Select
              id="task-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskKindValue)}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>

          {mode === "create" && (
            <div>
              <Label>Contact</Label>
              {fixedLeadId ? (
                <div className="mt-1 truncate rounded-xl border border-line bg-tint px-3 py-2.5 text-sm text-ink-soft">
                  {fixedLeadLabel ?? "This contact"}
                </div>
              ) : (
                <div className="mt-1">
                  <LeadPicker
                    value={leadId}
                    onChange={(id, l) => {
                      setLeadId(id);
                      setLeadName(l ? leadLabel(l) : null);
                    }}
                    heightClass="max-h-52"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="task-owner">Owner</Label>
            {!assignees ? (
              // Never render a name before the team has loaded. The owner may
              // already be set to the deal's owner, and showing "you" in the gap
              // would state the opposite of what is about to be submitted.
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-tint px-3 py-2.5 text-sm text-ink-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
              </div>
            ) : canChooseOwner ? (
              <Select
                id="task-owner"
                value={effectiveOwner ?? ""}
                onChange={(e) => setOwnerId(e.target.value || null)}
              >
                {assignees.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.isSelf ? `${m.name} (you)` : m.name}
                  </option>
                ))}
              </Select>
            ) : (
              // No picker when there is exactly one legal answer — a select with
              // one option implies a choice that does not exist.
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-tint px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-on-solid">
                  {initials(ownerRow?.name ?? "?")}
                </span>
                <span className="min-w-0 truncate text-sm text-ink-soft">
                  {ownerRow ? (ownerRow.isSelf ? `${ownerRow.name} (you)` : ownerRow.name) : "Unassigned"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="task-priority">Priority</Label>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITIES.find((p) => p.value === priority)?.dot}`}
                aria-hidden
              />
              <Select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriorityValue)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="task-title">
              What needs doing? <span className="text-danger">*</span>
            </Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call Priya about the proposal"
              maxLength={200}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) save();
              }}
            />
          </div>

          <div>
            <Label>Due</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    preset === p.key
                      ? "border-ink bg-ink text-ink-invert"
                      : "border-line text-ink-soft hover:border-ink hover:text-ink"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset("custom")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  preset === "custom"
                    ? "border-ink bg-ink text-ink-invert"
                    : "border-line text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                Pick a time
              </button>
            </div>

            {preset === "custom" ? (
              <Input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="mt-2"
                aria-label="Due date and time"
              />
            ) : (
              <p className="mt-2 text-xs text-ink-soft">
                {resolvedDue
                  ? resolvedDue.toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "No deadline. It sits in Today until you close it."}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="task-instruction">Instruction</Label>
            <Textarea
              id="task-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Anything the person picking this up needs to know"
              rows={4}
              maxLength={4000}
            />
          </div>

          {error && <Banner kind="error">{error}</Banner>}
        </div>
      </div>
    </Dialog>
  );
}
