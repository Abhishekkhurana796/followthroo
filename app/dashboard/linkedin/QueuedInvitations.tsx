"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { api } from "@/lib/client";
import { Badge, Button, Textarea } from "@/components/ui";
import { CREDIT_COSTS } from "@/lib/billing/plans";

type Hold = "needs_pick" | "no_notes_left" | "no_credits" | null;
type Invitation = {
  id: string;
  type: string;
  linkedinUrl: string;
  note: string | null;
  noteChoice: "yes" | "no" | "undecided";
  hold: Hold;
  leadName: string | null;
  company: string | null;
  title: string | null;
};
type Queue = {
  people: Invitation[];
  held: Invitation[];
  notes: { cap: number; left: number; exhaustedByLinkedIn: boolean };
  accountType: string;
};
type Patch = { noteChoice?: "yes" | "no"; note?: string };
type Filter = "all" | "note" | "pick" | "waiting";

/** LinkedIn's ceiling on a connection note. */
const NOTE_MAX = 300;

const withNote = (r: Invitation) => r.noteChoice === "yes" && r.hold !== "no_notes_left";
const FILTERS: { key: Filter; label: string; match: (r: Invitation) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "note", label: "With a note", match: withNote },
  { key: "pick", label: "Needs your pick", match: (r) => r.hold === "needs_pick" },
  { key: "waiting", label: "Waiting", match: (r) => r.hold === "no_notes_left" || r.hold === "no_credits" },
];

/**
 * Queued invitations, and which of them carry a note.
 *
 * This screen does not start outreach — campaigns do — and nothing here sends
 * anything. What it decides is how invitations already queued go out. A free
 * LinkedIn account gets a handful of personalised notes a day, so "which three"
 * is a choice about people rather than a setting, and it needs the people on
 * screen. The list is the same one the desktop app works from.
 */
export function QueuedInvitations() {
  const { data, mutate, isLoading } = useSWR<Queue>("/api/linkedin/invitations", { refreshInterval: 20_000 });
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="h-24 animate-pulse rounded-xl bg-tint" />
      </section>
    );
  }
  const rows = data ? [...data.people, ...data.held].filter((r) => r.type !== "message") : [];
  if (!data || rows.length === 0) return null;

  const shown = rows.filter(FILTERS.find((f) => f.key === filter)!.match);

  async function save(id: string, patch: Patch) {
    setError(null);
    try {
      await api(`/api/linkedin/invitations/${id}`, { method: "PATCH", body: patch });
      setEditing(null);
      await mutate();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  const { cap, left, exhaustedByLinkedIn } = data.notes;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold">Queued invitations</h2>
          <p className="mt-1 text-sm text-ink-soft">Who goes out next, in order — and which invites carry a note.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-tint px-3 py-2">
          {cap <= 5 && (
            <span className="flex gap-1" aria-hidden>
              {Array.from({ length: cap }, (_, i) => (
                <span key={i} className={`h-2 w-2 rounded-full ${i < left ? "bg-accent" : "bg-line-strong"}`} />
              ))}
            </span>
          )}
          <span className="font-mono text-xs text-ink">
            {exhaustedByLinkedIn ? "No notes left today" : `${left} of ${cap} notes left today`}
          </span>
          <span
            className="text-ink-soft"
            title={
              exhaustedByLinkedIn
                ? "LinkedIn said this account's personalised notes are used up for today. They start again tomorrow."
                : data.accountType === "free"
                  ? "Free LinkedIn accounts send 3 notes a day. Set your account type under Your LinkedIn → Limits."
                  : "Your account type allows a note on any invitation, up to your daily limit."
            }
          >
            <Info className="h-4 w-4" aria-hidden />
            <span className="sr-only">About the note allowance</span>
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                on ? "bg-accent-soft text-accent-strong" : "border border-line text-ink-soft hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`font-mono ${on ? "text-accent-strong" : "text-ink-faint"}`}>{rows.filter(f.match).length}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <ul className="mt-4 overflow-hidden rounded-xl border border-line">
        {shown.map((inv) => (
          <Row
            key={inv.id}
            inv={inv}
            editing={editing === inv.id}
            onEdit={() => setEditing(inv.id)}
            onCancel={() => setEditing(null)}
            onSave={(patch) => save(inv.id, patch)}
          />
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-soft">None right now.</li>}
      </ul>

      <p className="mt-3 flex gap-2 text-xs text-ink-soft">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Invites without a note keep going out all day. Notes are used in queue order and reset at midnight in your
        workspace&apos;s time zone.
      </p>
    </section>
  );
}

function Row({
  inv,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  inv: Invitation;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: Patch) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const on = inv.noteChoice === "yes";
  const name = inv.leadName ?? "LinkedIn member";
  const meta = [inv.title, inv.company].filter(Boolean).join(" · ") || inv.linkedinUrl;
  const labelId = `note-label-${inv.id}`;

  const line =
    inv.hold === "needs_pick"
      ? inv.note
        ? `Template note: “${inv.note}”`
        : "No template note — add one, or send it without."
      : inv.hold === "no_notes_left"
        ? "No notes left today. Sends tomorrow with its note — or switch the note off to send it today."
        : inv.hold === "no_credits"
          ? "Out of credits for today. Goes out when credits are back — at midnight, or once you add some."
          : on
          ? `“${inv.note}”`
          : "Sends without a note";

  async function decide(patch: Patch) {
    setBusy(true);
    await onSave(patch);
    setBusy(false);
  }

  return (
    <li className="border-b border-line bg-surface last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A66C2] font-display text-[13px] font-bold text-white">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{name}</span>
            <span className="font-mono text-[10px] text-ink-faint" title="What this invitation costs when it sends">
              {on ? CREDIT_COSTS.li_invite_note : CREDIT_COSTS.li_invite} credits
            </span>
            {inv.hold === "no_notes_left" && <Badge>Waits for tomorrow</Badge>}
            {inv.hold === "no_credits" && <Badge>Waits for credits</Badge>}
          </div>
          <div className="truncate text-xs text-ink-soft">{meta}</div>
          {!editing && <p className={`truncate text-xs ${inv.hold ? "text-ink-soft" : "text-ink-faint"}`}>{line}</p>}
        </div>

        {inv.hold === "needs_pick" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="warning">Needs your pick</Badge>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => (inv.note ? decide({ noteChoice: "yes" }) : onEdit())}>
              Add note
            </Button>
            <Button variant="subtle" size="sm" disabled={busy} onClick={() => decide({ noteChoice: "no" })}>
              No note
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center">
            <span id={labelId} className="text-xs font-semibold text-ink-soft">
              Note
            </span>
            {/* The track is 36×20; the button around it is the 44px target. */}
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={labelId}
              disabled={busy}
              onClick={() => (!on && !inv.note ? onEdit() : decide({ noteChoice: on ? "no" : "yes" }))}
              className="group flex h-11 w-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            >
              <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-line-strong"}`}>
                <span
                  className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`}
                />
              </span>
            </button>
            <button
              type="button"
              aria-expanded={editing}
              aria-label={editing ? `Close ${name}'s note` : `Open ${name}'s note`}
              onClick={editing ? onCancel : onEdit}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-tint hover:text-ink"
            >
              {editing ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
      {editing && <NoteEditor inv={inv} onCancel={onCancel} onSave={(note) => onSave({ noteChoice: "yes", note })} />}
    </li>
  );
}

function NoteEditor({
  inv,
  onCancel,
  onSave,
}: {
  inv: Invitation;
  onCancel: () => void;
  onSave: (note: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(inv.note ?? "");
  const [busy, setBusy] = useState(false);
  const len = text.trim().length;
  const over = len > NOTE_MAX;

  return (
    <div className="px-4 pb-4 pl-[60px]">
      <Textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={`Note for ${inv.leadName ?? "this invitation"}`}
        className="!border-2 !border-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-ink-soft">
        <span>Edits apply to this invitation only.</span>
        <span className={`font-mono ${over ? "font-semibold text-danger" : ""}`}>
          {len} / {NOTE_MAX}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          loading={busy}
          disabled={len === 0 || over}
          onClick={async () => {
            setBusy(true);
            await onSave(text.trim());
            setBusy(false);
          }}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}
