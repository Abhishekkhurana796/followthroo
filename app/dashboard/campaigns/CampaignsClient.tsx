"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Plus, X, Rocket, Mail, Link as LinkIcon, MessageSquare, Clock, ArrowDown,
  Sparkles, Server, GitBranch, LayoutTemplate, PenLine, Trash2, Users, StopCircle, Pencil, Square,
} from "lucide-react";
import { api } from "@/lib/client";
import { Banner, DashHeader, Dialog, Input, Label, Panel, Select, useConfirm } from "@/components/ui";
import { tourTarget } from "@/components/dashboard/tour/target";
import Link from "next/link";
import { INVITE_NOTE_MAX, INVITE_NOTE_WARN, worstCaseNoteLength } from "@/lib/linkedin/note";
import { creditsPerLead } from "@/lib/billing/estimate";
import { SUMMARY_KEY, type Summary } from "@/components/dashboard/billing/types";

type Template = { id: string; channel: string; name: string; body?: string };
type SendingAccount = { id: string; name: string; email: string };
type Segment = { id: string; name: string; count: number };
type Campaign = {
  id: string;
  name: string;
  status: string;
  sequence: unknown;
  sendingAccountId: string | null;
  sendingAccount?: SendingAccount | null;
  _count?: { enrollments: number };
};

/**
 * What a step does, as one choice.
 *
 * The builder used to ask for a channel, and LinkedIn's two very different
 * gestures — asking to connect, and messaging someone you are already connected
 * to — hid behind the single option "LinkedIn". Which one actually happened was
 * decided later by a setting inside the Chrome extension, where nobody building
 * a sequence would think to look.
 *
 * This is a composite key for the UI only. The saved graph keeps `channel` and
 * `linkedinAction` as separate fields, because `channel` is a database enum
 * shared with templates and messages.
 */
type StepType = "email" | "linkedin_invite" | "linkedin_message" | "whatsapp" | "social";

const STEP_TYPES: { value: StepType; label: string; hint?: string }[] = [
  { value: "email", label: "Email", hint: "Goes out from your connected mailbox." },
  {
    value: "linkedin_invite",
    label: "LinkedIn connection request",
    hint: "Sent from the desktop app on your computer, at a human pace.",
  },
  {
    value: "linkedin_message",
    label: "LinkedIn message",
    hint: "Only reaches people you are already connected to — put this after a connection request.",
  },
  { value: "whatsapp", label: "WhatsApp", hint: "Needs a template WhatsApp has approved." },
];

/** The channel a step type sends on, and the LinkedIn gesture if it is one. */
function splitStepType(stepType: StepType): { channel: string; linkedinAction?: "invite" | "message" } {
  if (stepType === "linkedin_invite") return { channel: "linkedin", linkedinAction: "invite" };
  if (stepType === "linkedin_message") return { channel: "linkedin", linkedinAction: "message" };
  return { channel: stepType };
}

/**
 * The reverse. A stored LinkedIn step with no explicit kind is legacy "auto";
 * it is shown as a connection request because that is what auto tries first,
 * but the stored value is left alone unless the step is actually edited.
 */
function joinStepType(channel?: string, linkedinAction?: string | null): StepType {
  if (channel !== "linkedin") return (channel ?? "email") as StepType;
  return linkedinAction === "message" ? "linkedin_message" : "linkedin_invite";
}

// Builder node shapes (UI). Converted to the engine graph on save.
type SendNode = {
  type: "send";
  stepType: StepType;
  templateId: string;
  /** Pin to a template snapshot. Carried through edits — dropping it silently
   *  unpinned a pinned step every time somebody re-saved a campaign. */
  templateVersionId?: string | null;
  /** The stored kind, kept verbatim so an untouched legacy "auto" stays "auto". */
  storedAction?: string | null;
  /** Invite steps only: who gets the template as a note. Absent on steps saved before it existed. */
  noteFor?: "everyone" | "picked" | "none";
  waitDays: number;
};
type CondNode = { type: "condition"; on: "replied" | "opened" | "clicked"; yes: "stop" | "continue"; no: "stop" | "continue" };
/**
 * A node the builder cannot create but must not destroy.
 *
 * `wait` and `exit` nodes were previously rewritten into sends on load, so
 * opening a campaign that had one and saving it silently changed what the
 * campaign did. Round-trip them untouched instead: a node you can see being
 * quietly corrupted is worse than a button you do not have.
 */
type OpaqueNode = { type: "opaque"; raw: Record<string, unknown> };
type BuilderNode = SendNode | CondNode | OpaqueNode;

const newSend = (waitDays = 0): SendNode => ({ type: "send", stepType: "email", templateId: "", waitDays });
const newCond = (): CondNode => ({ type: "condition", on: "replied", yes: "stop", no: "continue" });

const PRESETS: { name: string; blurb: string; nodes: BuilderNode[] }[] = [
  { name: "3-step email drip", blurb: "Three emails, spaced a few days apart.", nodes: [newSend(0), newSend(3), newSend(5)] },
  { name: "Stop on reply", blurb: "Email, then only follow up if they didn't reply.", nodes: [newSend(0), { type: "condition", on: "replied", yes: "stop", no: "continue" }, newSend(4)] },
  { name: "Multichannel touch", blurb: "Email, then a connection request, then WhatsApp.", nodes: [newSend(0), { type: "send", stepType: "linkedin_invite", templateId: "", waitDays: 2 }, { type: "send", stepType: "whatsapp", templateId: "", waitDays: 3 }] },
  // The LinkedIn step type existed for weeks and no campaign ever used it — a
  // dropdown option is not discoverable, a preset is. This is the shape people
  // actually want: ask to connect, wait, then message once they have accepted.
  {
    name: "LinkedIn: connect, then follow up",
    blurb: "A connection request, then a message three days later.",
    nodes: [
      { type: "send", stepType: "linkedin_invite", templateId: "", waitDays: 0 },
      { type: "send", stepType: "linkedin_message", templateId: "", waitDays: 3 },
    ],
  },
];

// Turn the linear builder list into the engine's node graph.
function toGraph(nodes: BuilderNode[]) {
  const out = nodes.map((n, i) => {
    const id = `n${i}`;
    const nextId = i < nodes.length - 1 ? `n${i + 1}` : null;
    if (n.type === "opaque") {
      // Preserved verbatim apart from its position in the chain.
      const { ...rest } = n.raw;
      return rest.type === "exit" ? { ...rest, id } : { ...rest, id, next: nextId };
    }
    if (n.type === "send") {
      const { channel, linkedinAction } = splitStepType(n.stepType);
      return {
        id,
        type: "send",
        channel,
        // An untouched legacy step keeps the "auto" it was saved with; anything
        // the person actually chose is written explicitly.
        ...(channel === "linkedin" ? { linkedinAction: linkedinAction ?? n.storedAction ?? undefined } : {}),
        // Only an invitation has a note to choose; left off entirely otherwise,
        // so a step that never set it keeps the old "a note when there is one".
        ...(n.stepType === "linkedin_invite" && n.noteFor ? { noteFor: n.noteFor } : {}),
        templateId: n.templateId || undefined,
        templateVersionId: n.templateVersionId ?? undefined,
        waitDays: Number(n.waitDays) || 0,
        next: nextId,
      };
    }
    return { id, type: "condition", on: n.on, onYes: n.yes === "continue" ? nextId : null, onNo: n.no === "continue" ? nextId : null };
  });
  return { nodes: out, startNodeId: nodes.length ? "n0" : null };
}

// Convert a stored graph back into the flat builder node list for editing.
function fromGraph(seq: unknown): BuilderNode[] {
  const asSend = (s: Record<string, unknown>): SendNode => ({
    type: "send",
    stepType: joinStepType(s.channel as string | undefined, s.linkedinAction as string | null | undefined),
    templateId: (s.templateId as string) ?? "",
    templateVersionId: (s.templateVersionId as string | null) ?? null,
    storedAction: (s.linkedinAction as string | null) ?? null,
    noteFor: (s.noteFor as SendNode["noteFor"]) ?? undefined,
    waitDays: (s.waitDays as number) ?? 0,
  });

  if (Array.isArray(seq)) return seq.map((s) => asSend(s));

  const g = seq as { nodes?: Record<string, unknown>[] };
  if (!g?.nodes) return [newSend(0)];
  return g.nodes.map((n) => {
    if (n.type === "condition") {
      return {
        type: "condition",
        on: ((n.on as string) ?? "replied") as CondNode["on"],
        yes: n.onYes ? "continue" : "stop",
        no: n.onNo ? "continue" : "stop",
      } as CondNode;
    }
    // Anything that is not a send or a condition is kept as-is rather than being
    // flattened into a send, which is what used to happen to wait and exit.
    if (n.type !== "send") return { type: "opaque", raw: n } as OpaqueNode;
    return asSend(n);
  });
}

// Extract a flat display list from a stored sequence (graph or legacy array).
function displayNodes(seq: unknown): { kind: string; stepType?: StepType; waitDays?: number; on?: string }[] {
  const label = (s: Record<string, unknown>) =>
    joinStepType(s.channel as string | undefined, s.linkedinAction as string | null | undefined);
  if (Array.isArray(seq)) return seq.map((s) => ({ kind: "send", stepType: label(s), waitDays: s.waitDays }));
  const g = seq as { nodes?: Record<string, unknown>[] };
  if (g?.nodes)
    return g.nodes.map((n) => ({
      kind: n.type as string,
      stepType: n.type === "send" ? label(n) : undefined,
      waitDays: n.waitDays as number | undefined,
      on: n.on as string | undefined,
    }));
  return [];
}

/** Short label for a chip, where "LinkedIn" alone would not say which gesture. */
const stepLabel = (stepType?: StepType) =>
  stepType === "linkedin_invite" ? "invite"
  : stepType === "linkedin_message" ? "LinkedIn DM"
  : stepType ?? "";

const channelIcon = (stepType?: StepType) => {
  switch (stepType) {
    case "email": return <Mail className="h-5 w-5 text-accent" />;
    case "linkedin_invite":
    case "linkedin_message": return <LinkIcon className="h-5 w-5 text-info" />;
    case "whatsapp": return <MessageSquare className="h-5 w-5 text-success" />;
    default: return <Sparkles className="h-5 w-5 text-warning" />;
  }
};

export default function CampaignsPage() {
  const { data: campaigns = [], mutate: mutateCampaigns } = useSWR<Campaign[]>("/api/campaigns");
  const { data: templates = [] } = useSWR<Template[]>("/api/templates");
  const { data: sendingAccounts = [] } = useSWR<SendingAccount[]>("/api/sending-accounts");
  const { data: segments = [] } = useSWR<Segment[]>("/api/segments");
  // Whether LinkedIn steps will actually run. Fetched here so the builder can say
  // so while the sequence is being written, rather than letting steps queue up
  // against an account that was never connected.
  const { data: linkedinConn } = useSWR<{ account?: { state?: string } }>("/api/linkedin/connect");
  const linkedinReady = linkedinConn ? linkedinConn.account?.state !== "disconnected" : undefined;
  const confirm = useConfirm();

  const [mode, setMode] = useState<"list" | "choose" | "build">("list");
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [name, setName] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [nodes, setNodes] = useState<BuilderNode[]>([newSend(0)]);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [launchFor, setLaunchFor] = useState<Campaign | null>(null);

  function patchNode(i: number, patch: Partial<SendNode> & Partial<CondNode>) {
    setNodes((ns) => ns.map((n, idx) => (idx === i ? ({ ...n, ...patch } as BuilderNode) : n)));
  }

  function startManual() { setEditingCampaign(null); setNodes([newSend(0)]); setName(""); setSelectedAccount(""); setMode("build"); }
  function startFromPreset(p: (typeof PRESETS)[number]) {
    setEditingCampaign(null); setNodes(p.nodes.map((n) => ({ ...n }))); setName(p.name); setSelectedAccount(""); setMode("build");
  }
  function startEdit(c: Campaign) {
    setEditingCampaign(c);
    setName(c.name);
    setSelectedAccount(c.sendingAccountId ?? "");
    setNodes(fromGraph(c.sequence));
    setMsg(null);
    setMode("build");
  }

  /** Does this sequence actually send email? Only then is a mailbox required. */
  const needsMailbox = nodes.some((n) => n.type === "send" && n.stepType === "email");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setMsg({ kind: "error", text: "Campaign name is required." });
    // A mailbox is only needed if something in the sequence actually sends email.
    // Requiring one on a LinkedIn-only campaign asked people to nominate an
    // address that would never be used, and blocked the sequence until they did.
    if (needsMailbox && !selectedAccount) {
      return setMsg({ kind: "error", text: "Choose the mailbox the email steps send from." });
    }
    setBusy(true); setMsg(null);
    try {
      const body = { name, sequence: toGraph(nodes), sendingAccountId: selectedAccount || null };
      if (editingCampaign) {
        await api(`/api/campaigns/${editingCampaign.id}`, { method: "PATCH", body });
        setMsg({ kind: "success", text: "Campaign updated." });
      } else {
        await api("/api/campaigns", { body });
        setMsg({ kind: "success", text: "Campaign created." });
      }
      setMode("list");
      setEditingCampaign(null);
      mutateCampaigns();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function launch(target: { segmentId?: string; allLeads?: boolean }) {
    if (!launchFor) return;
    setMsg(null);
    try {
      let res: { enrolled: number; skipped: number; enqueued: number; queueAvailable: boolean };
      if (target.segmentId) {
        res = await api(`/api/campaigns/${launchFor.id}/enroll`, { body: { segmentId: target.segmentId } });
      } else {
        // "All leads" — fetch up to 500 and enroll
        const { items: leads } = await api<{ items: { id: string }[] }>("/api/leads?pageSize=500");
        if (leads.length === 0) { setMsg({ kind: "error", text: "No leads to launch to." }); setLaunchFor(null); return; }
        res = await api(`/api/campaigns/${launchFor.id}/enroll`, { body: { leadIds: leads.map((l) => l.id) } });
      }
      setMsg({
        kind: res.queueAvailable ? "success" : "info",
        text: `Enrolled ${res.enrolled} lead(s)${res.skipped ? `, skipped ${res.skipped} already enrolled` : ""}. ${
          res.queueAvailable ? "Sequence is running." : "Queue unavailable — set REDIS_URL/QStash or use dev inline."
        }`,
      });
      setLaunchFor(null);
      mutateCampaigns();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
      setLaunchFor(null);
    }
  }

  async function stopCampaign(c: Campaign) {
    const ok = await confirm({
      title: `Stop "${c.name}"?`,
      body: "Contacts partway through the sequence stop receiving it. You can't resume a stopped campaign.",
      confirmLabel: "Stop campaign",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/campaigns/${c.id}`, { method: "PATCH", body: { status: "done" } });
      mutateCampaigns();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function reactivateCampaign(c: Campaign) {
    try {
      await api(`/api/campaigns/${c.id}`, { method: "PATCH", body: { status: "active" } });
      mutateCampaigns();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  /**
   * Delete, after saying exactly what stops.
   *
   * The dry run asks the server what would happen first, because that answer is
   * the useful part of the confirmation: "5 queued LinkedIn invitations are
   * cancelled" is the sentence that stops someone deleting a campaign they only
   * meant to pause.
   */
  async function deleteCampaign(c: Campaign) {
    setMsg(null);
    try {
      const impact = await api<{ stopping: number; cancelling: number; archived: boolean }>(
        `/api/campaigns/${c.id}?dryRun=1`,
        { method: "DELETE" },
      );
      const effects = [
        impact.stopping
          ? `${impact.stopping} ${impact.stopping === 1 ? "person" : "people"} partway through the sequence stop receiving it.`
          : null,
        impact.cancelling
          ? `${impact.cancelling} queued LinkedIn ${impact.cancelling === 1 ? "invitation is" : "invitations are"} cancelled.`
          : null,
        impact.archived
          ? "Messages already sent stay on each lead's timeline and keep naming this campaign."
          : "Nothing has been sent from it yet, so it is removed completely.",
      ].filter(Boolean);
      const yes = await confirm({
        title: `Delete "${c.name}"?`,
        body: effects.join(" "),
        confirmLabel: "Delete campaign",
        tone: "danger",
      });
      if (!yes) return;
      await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
      setMsg({ kind: "success", text: `"${c.name}" deleted.` });
      mutateCampaigns();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <>
      <DashHeader
        title="Campaigns"
        subtitle="Design conditional outreach sequences, then enroll a group or individual leads."
        action={mode === "list" && (
          <button {...tourTarget("campaigns-new")} onClick={() => setMode("choose")} className="btn btn-primary flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> New Campaign
          </button>
        )}
      />

      <div className="p-8">
        {msg && <div className="mb-6"><Banner kind={msg.kind}>{msg.text}</Banner></div>}

        {/* ---- Two-path chooser ---- */}
        {mode === "choose" && (
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">How do you want to start?</h2>
              <button onClick={() => setMode("list")} className="rounded-lg p-1.5 text-ink-soft hover:bg-tint hover:text-ink"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <Panel className="flex flex-col">
                <LayoutTemplate className="h-8 w-8 text-accent" />
                <h3 className="mt-4 font-display text-lg font-bold">Start with a template</h3>
                <p className="mt-1 text-sm text-ink-soft">Ready-made sequences you can tweak.</p>
                <div className="mt-4 space-y-2">
                  {PRESETS.map((p) => (
                    <button key={p.name} onClick={() => startFromPreset(p)} className="w-full rounded-xl border border-line px-4 py-3 text-left transition hover:border-ink hover:bg-tint">
                      <div className="text-sm font-semibold">{p.name}</div>
                      <div className="text-xs text-ink-soft">{p.blurb}</div>
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel className="flex flex-col">
                <PenLine className="h-8 w-8 text-success" />
                <h3 className="mt-4 font-display text-lg font-bold">Create manually</h3>
                <p className="mt-1 text-sm text-ink-soft">Build steps and conditional branches from scratch.</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-soft">
                  <li className="flex items-center gap-2"><Mail className="h-4 w-4" /> Multi-channel steps with wait times</li>
                  <li className="flex items-center gap-2"><GitBranch className="h-4 w-4" /> Branch on reply / open / click</li>
                  <li className="flex items-center gap-2"><Users className="h-4 w-4" /> Enroll a group or a single lead</li>
                </ul>
                <button onClick={startManual} className="btn btn-primary mt-4 justify-center">Create manual campaign</button>
              </Panel>
            </div>
          </div>
        )}

        {/* ---- Builder ---- */}
        {mode === "build" && (
          <Panel className="border-line/70">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <h2 className="font-display text-xl font-bold">{editingCampaign ? `Edit: ${editingCampaign.name}` : "Sequence builder"}</h2>
                <p className="text-xs text-ink-soft">Steps run top to bottom. A reply halts the sequence unless a condition says otherwise.</p>
              </div>
              <button onClick={() => { setMode("list"); setEditingCampaign(null); }} className="rounded-lg p-1.5 text-ink-soft hover:bg-tint hover:text-ink"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
              <div className="flex flex-col items-center rounded-2xl border border-line/40 bg-canvas px-4 py-8">
                <div className="w-full max-w-[460px]">
                  <div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-success/40 bg-success-soft px-5 py-3 text-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-success" />
                    <div className="font-mono text-xs font-bold uppercase tracking-wider text-success-strong">Trigger: Enroll lead</div>
                  </div>
                  <Connector />

                  {nodes.map((n, i) => (
                    <div key={i} className="w-full">
                      <div className="relative rounded-2xl border border-line bg-surface p-5 shadow-sm">
                        <div className="absolute -left-3 top-5 flex h-7 w-7 items-center justify-center rounded-full bg-ink font-mono text-xs font-bold text-ink-invert">{i + 1}</div>
                        <div className="pl-4">
                          <div className="mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {n.type === "send" ? channelIcon(n.stepType) : n.type === "opaque" ? <Clock className="h-5 w-5 text-ink-soft" /> : <GitBranch className="h-5 w-5 text-warning" />}
                              <span className="font-display text-xs font-bold uppercase tracking-wide">
                                {n.type === "send"
                                  ? STEP_TYPES.find((s) => s.value === n.stepType)?.label ?? n.stepType
                                  : n.type === "opaque"
                                    ? String(n.raw.type)
                                    : "Condition"}
                              </span>
                            </div>
                            <button type="button" onClick={() => setNodes((ns) => ns.filter((_, idx) => idx !== i))} className="rounded p-1 text-ink-soft transition hover:bg-danger-soft hover:text-danger">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          {n.type === "send" ? (
                            <div className="grid gap-3">
                              <div className="flex items-center gap-2 rounded-xl border border-line/60 bg-canvas px-3 py-1.5">
                                <Clock className="h-4 w-4 text-ink-soft" />
                                <span className="text-xs text-ink-soft">Wait</span>
                                <input type="number" min={0} value={n.waitDays} onChange={(e) => patchNode(i, { waitDays: Number(e.target.value) })} className="w-16 rounded border border-line bg-surface px-2 py-0.5 text-center font-mono text-xs outline-none focus:border-ink" />
                                <span className="text-xs text-ink-soft">days, then send</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label>Step</Label>
                                  <Select
                                    value={n.stepType}
                                    onChange={(e) =>
                                      patchNode(i, {
                                        stepType: e.target.value as StepType,
                                        templateId: "",
                                        templateVersionId: null,
                                        // The person has now said what they want, so the
                                        // legacy "auto" no longer applies.
                                        storedAction: null,
                                      })
                                    }
                                  >
                                    {STEP_TYPES.map((s) => (
                                      <option key={s.value} value={s.value}>{s.label}</option>
                                    ))}
                                  </Select>
                                </div>
                                <div>
                                  <Label>Template</Label>
                                  <Select value={n.templateId} onChange={(e) => patchNode(i, { templateId: e.target.value, templateVersionId: null })}>
                                    <option value="">No template</option>
                                    {templates
                                      .filter((t) => t.channel === splitStepType(n.stepType).channel)
                                      .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                  </Select>
                                </div>
                              </div>

                              {STEP_TYPES.find((s) => s.value === n.stepType)?.hint && (
                                <p className="text-xs text-ink-soft">{STEP_TYPES.find((s) => s.value === n.stepType)!.hint}</p>
                              )}

                              {/* The 300-character ceiling only exists on a connection
                                  note, so the meter only appears on that step. It is
                                  measured against the longest the variables could render
                                  to, since a note that fits only when {{company}} is
                                  empty is one that fails on a real lead. */}
                              {n.stepType === "linkedin_invite" && n.noteFor !== "none" && (() => {
                                const body = templates.find((t) => t.id === n.templateId)?.body ?? "";
                                if (!body) return null;
                                const len = worstCaseNoteLength(body);
                                const over = len > INVITE_NOTE_MAX;
                                return (
                                  <p className={`text-xs ${over ? "text-danger" : len > INVITE_NOTE_WARN ? "text-warning" : "text-ink-soft"}`}>
                                    About {len} of {INVITE_NOTE_MAX} characters once personalised
                                    {over ? " — LinkedIn will refuse this. Shorten the template." : ""}
                                  </p>
                                );
                              })()}

                              {/* Who gets the template as a note. A free LinkedIn account
                                  gets a handful of notes a day, so this decides which
                                  invitations spend them. Unset reads as Everyone, which
                                  is what every step did before the choice existed. */}
                              {n.stepType === "linkedin_invite" && (() => {
                                const options = [
                                  { value: "everyone", label: "Everyone", hint: "The template above is the note. Free LinkedIn accounts send 3 notes a day — invitations beyond that wait for the next day's notes." },
                                  { value: "picked", label: "Leads I pick", hint: "Invitations wait in LinkedIn → Queued invitations until you choose Add note or No note for each person." },
                                  { value: "none", label: "No one", hint: "Plain connection requests. No daily note limit, and the template isn't used." },
                                ] as const;
                                const current = n.noteFor ?? "everyone";
                                return (
                                  <div>
                                    <Label>Add a note for</Label>
                                    <div role="radiogroup" aria-label="Add a note for" className="inline-flex flex-wrap gap-0.5 rounded-full bg-tint p-1">
                                      {options.map((o) => {
                                        const on = current === o.value;
                                        return (
                                          <button
                                            key={o.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={on}
                                            onClick={() => patchNode(i, { noteFor: o.value })}
                                            className={`min-h-11 rounded-full px-4 text-xs font-semibold transition-colors ${on ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
                                          >
                                            {o.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <p className="mt-1.5 text-xs text-ink-soft">{options.find((o) => o.value === current)!.hint}</p>
                                  </div>
                                );
                              })()}

                              {n.stepType.startsWith("linkedin_") && linkedinReady === false && (
                                <p className="text-xs text-warning">
                                  Your LinkedIn account isn&apos;t connected yet, so these steps will sit in the queue.{" "}
                                  <Link href="/dashboard/linkedin" className="underline">Set it up</Link>.
                                </p>
                              )}
                            </div>
                          ) : n.type === "opaque" ? (
                            /* A step this builder cannot edit. Shown so it is
                               visible and kept so saving does not rewrite it. */
                            <p className="text-xs text-ink-soft">
                              {n.raw.type === "exit"
                                ? "Ends the sequence here."
                                : `Waits ${String(n.raw.waitDays ?? 1)} day(s).`}{" "}
                              Kept as it is — this builder can show it but not change it.
                            </p>
                          ) : (
                            <div className="grid gap-3">
                              <div>
                                <Label>If the lead has</Label>
                                <Select value={n.on} onChange={(e) => patchNode(i, { on: e.target.value as CondNode["on"] })}>
                                  <option value="replied">Replied</option>
                                  <option value="opened">Opened (needs tracking)</option>
                                  <option value="clicked">Clicked (needs tracking)</option>
                                </Select>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label>Then (yes)</Label>
                                  <Select value={n.yes} onChange={(e) => patchNode(i, { yes: e.target.value as "stop" | "continue" })}>
                                    <option value="stop">Stop sequence</option>
                                    <option value="continue">Continue</option>
                                  </Select>
                                </div>
                                <div>
                                  <Label>Else (no)</Label>
                                  <Select value={n.no} onChange={(e) => patchNode(i, { no: e.target.value as "stop" | "continue" })}>
                                    <option value="continue">Continue</option>
                                    <option value="stop">Stop sequence</option>
                                  </Select>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <Connector />
                    </div>
                  ))}

                  <div className="flex items-center justify-center gap-2">
                    <button type="button" onClick={() => setNodes((ns) => [...ns, newSend(2)])} className="flex items-center gap-1 rounded-full border-2 border-dashed border-ink-soft bg-surface px-3 py-2 text-xs font-medium text-ink-soft transition hover:border-ink hover:text-ink">
                      <Plus className="h-4 w-4" /> Message
                    </button>
                    <button type="button" onClick={() => setNodes((ns) => [...ns, newCond()])} className="flex items-center gap-1 rounded-full border-2 border-dashed border-warning/40 bg-surface px-3 py-2 text-xs font-medium text-warning-strong transition hover:border-warning/40">
                      <GitBranch className="h-4 w-4" /> Condition
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Panel className="border-line/60">
                  <h3 className="font-display text-lg font-bold">Campaign info</h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <Label>Campaign title *</Label>
                      <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Sales Follow-up" />
                    </div>
                    {/* Only shown when the sequence actually contains an email
                        step. A LinkedIn-only campaign has no use for a mailbox,
                        and asking for one implied invites go out through it. */}
                    {needsMailbox ? (
                      <div>
                        <Label>Send email from *</Label>
                        <Select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
                          <option value="">Select a mailbox…</option>
                          {sendingAccounts.map((acc) => <option key={acc.id} value={acc.id}>{acc.name} ({acc.email})</option>)}
                        </Select>
                        {sendingAccounts.length === 0 && (
                          <p className="mt-1.5 text-xs text-danger">
                            No mailbox connected. The email steps can&apos;t send until you connect one in Sending accounts.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-soft">
                        No mailbox needed — nothing here sends email. LinkedIn steps go out through your connected
                        LinkedIn account.
                      </p>
                    )}
                  </div>
                </Panel>
                <div className="flex gap-2">
                  <button onClick={() => { setMode("list"); setEditingCampaign(null); }} className="flex-1 rounded-xl border border-line bg-surface py-3 text-sm font-semibold transition hover:bg-tint">Cancel</button>
                  <button onClick={save} disabled={busy} className="btn btn-primary flex-1 justify-center py-3 text-sm font-semibold disabled:opacity-50">{editingCampaign ? "Update campaign" : "Save campaign"}</button>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {/* ---- List ---- */}
        {mode === "list" && (
          campaigns.length === 0 ? (
            <Panel>
              <div className="py-10 text-center">
                <Rocket className="mx-auto h-12 w-12 text-ink-faint" />
                <h3 className="mt-4 text-base font-bold">No campaigns yet</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">Design a conditional sequence and enroll a group or individual leads.</p>
                <button onClick={() => setMode("choose")} className="btn btn-primary mt-6 inline-flex">Create your first campaign</button>
              </div>
            </Panel>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {campaigns.map((c) => {
                const dn = displayNodes(c.sequence);
                return (
                  <Panel key={c.id} className="flex flex-col justify-between border-line/70 transition hover:border-ink/50">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-display text-lg font-bold">{c.name}</h3>
                        <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${c.status === "active" ? "bg-success-soft text-success-strong" : "bg-tint text-ink-soft"}`}>{c.status}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-line/40 bg-canvas p-3">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success font-mono text-[10px] font-bold text-on-solid" title="Start">S</span>
                        {dn.map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <div className="h-0.5 w-3 bg-line" />
                            <div className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 font-mono text-[10px] font-medium">
                              {s.kind === "condition" ? <><GitBranch className="h-3.5 w-3.5 text-warning" /><span>{s.on}?</span></> : s.kind === "exit" ? <><StopCircle className="h-3.5 w-3.5" /><span>exit</span></> : <>{channelIcon(s.stepType)}<span>{stepLabel(s.stepType)}</span>{(s.waitDays ?? 0) > 0 && <span className="ml-0.5 font-bold text-accent">+{s.waitDays}d</span>}</>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {c.sendingAccount && (
                        <div className="mt-4 flex items-center gap-1.5 text-xs text-ink-soft">
                          <Server className="h-3.5 w-3.5" /> Sender: <strong className="text-ink">{c.sendingAccount.name}</strong>
                        </div>
                      )}
                    </div>
                    <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
                      <span className="text-xs text-ink-soft">{c._count?.enrollments ?? 0} enrolled · {dn.length} node(s)</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => deleteCampaign(c)} aria-label={`Delete ${c.name}`} title="Delete campaign" className="rounded-xl border border-line bg-surface p-2 text-ink-soft transition hover:border-danger/30 hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(c)} className="flex items-center gap-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold transition hover:bg-tint"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                        {c.status === "done" ? (
                          <button onClick={() => reactivateCampaign(c)} className="flex items-center gap-1 rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-xs font-semibold text-success-strong transition hover:bg-success-soft"><Rocket className="h-3.5 w-3.5" /> Reactivate</button>
                        ) : (
                          <>
                            {c.status === "active" && (
                              <button onClick={() => stopCampaign(c)} className="flex items-center gap-1 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger transition hover:bg-danger/15"><Square className="h-3.5 w-3.5" /> Stop</button>
                            )}
                            <button onClick={() => setLaunchFor(c)} className="btn btn-primary !py-2 !text-xs flex items-center gap-1"><Rocket className="h-3.5 w-3.5" /> Launch</button>
                          </>
                        )}
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ---- Launch / enroll modal ---- */}
      <Dialog
        open={!!launchFor}
        onClose={() => setLaunchFor(null)}
        title={launchFor ? `Launch “${launchFor.name}”` : ""}
        description="Choose who to enroll into this sequence."
        footer={
          <button onClick={() => setLaunchFor(null)} className="w-full rounded-xl border border-line py-2.5 text-sm font-semibold transition hover:bg-tint">
            Cancel
          </button>
        }
      >
        {launchFor && (
          <div className="space-y-2">
              <CreditEstimate sequence={launchFor.sequence} />
              {/* Groups first — safer, explicit targeting */}
              {segments.length > 0 ? (
                <>
                  <div className="font-mono text-xs uppercase text-ink-soft">Launch to a group</div>
                  {segments.map((s) => (
                    <button key={s.id} onClick={() => launch({ segmentId: s.id })} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left transition hover:border-accent hover:bg-accent-soft">
                      <span className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4 text-accent" />{s.name}</span>
                      <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-xs text-accent">{s.count} leads</span>
                    </button>
                  ))}
                  <div className="pt-2 font-mono text-xs uppercase text-ink-soft">Or enroll everyone</div>
                </>
              ) : (
                <div className="pb-1 font-mono text-xs uppercase text-ink-soft">No groups yet — enroll everyone</div>
              )}
              {/* All leads — demoted, requires confirmation to avoid accidents */}
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Enroll every lead?",
                    body: "This sends messages to everyone in your list, up to 500 leads. There's no way to un-send them.",
                    confirmLabel: "Enroll everyone",
                    tone: "danger",
                  });
                  if (!ok) return;
                  launch({ allLeads: true });
                }}
                className="flex w-full items-center justify-between rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-left transition hover:border-warning/40 hover:bg-warning-soft"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-warning-strong"><Users className="h-4 w-4" /> All leads</span>
                <span className="font-mono text-xs text-warning-strong">up to 500 · confirm required</span>
              </button>
          </div>
        )}
      </Dialog>
    </>
  );
}

/**
 * The credit estimate before a launch, once billing is on: the most one lead can
 * cost across this sequence, and what's left today. Enrolling itself is free —
 * this is what the steps will take as they go out.
 */
function CreditEstimate({ sequence }: { sequence: unknown }) {
  const { data } = useSWR<Summary>(SUMMARY_KEY);
  const perLead = creditsPerLead(sequence);
  if (!data?.enforced || perLead === 0) return null;
  const left = data.credits.left + data.credits.topup;
  return (
    <div className="mb-3 rounded-xl bg-accent-soft/60 px-4 py-3">
      <div className="text-sm font-semibold text-accent-strong">
        Up to {perLead} {perLead === 1 ? "credit" : "credits"} per lead, over the whole sequence
      </div>
      <p className="mt-0.5 text-xs text-ink-soft">
        Taken only as each step actually goes out — a skipped or failed step costs nothing. You have {left.toLocaleString("en-US")} left
        today; steps beyond that wait for tomorrow&apos;s credits.
      </p>
    </div>
  );
}

function Connector() {
  return (
    <div className="relative mx-auto my-1 h-8 w-0.5 bg-line">
      <ArrowDown className="absolute -bottom-2 -left-[8px] h-4 w-4 text-line" />
    </div>
  );
}
