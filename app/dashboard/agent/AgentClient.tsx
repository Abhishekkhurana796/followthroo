"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bot, Play, FileEdit, Check, X } from "lucide-react";
import { api } from "@/lib/client";
import { Banner, DashHeader, Label, Panel, Select, Textarea, useConfirm, useToast } from "@/components/ui";
import { LeadPicker, leadLabel, type PickerLead } from "@/components/dashboard/LeadPicker";
type Draft = {
  id: string;
  channel: string;
  renderedSubject: string | null;
  renderedBody: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; email: string | null };
};

const CONFIDENCE_PRESETS = [
  { value: 0.9, label: "Conservative — draft unless very sure" },
  { value: 0.7, label: "Balanced" },
  { value: 0.4, label: "Autonomous — send unless clearly wrong" },
];

export default function AgentPage() {
  const { data: accounts = [] } = useSWR<Array<{ id: string; name: string; email: string }>>("/api/sending-accounts");
  const { data: drafts = [], mutate: mutateDrafts } = useSWR<Draft[]>("/api/agent/drafts");
  const confirm = useConfirm();
  const toast = useToast();

  const [selectedAccount, setSelectedAccount] = useState("");
  // One lead, deliberately. This page sends real mail, and the previous version
  // ticked every loaded lead on mount — a 200-recipient blast one click away.
  const [lead, setLead] = useState<PickerLead | null>(null);
  const [brief, setBrief] = useState("Introduce Followthroo warmly in 3 sentences and ask for a quick call.");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  const [result, setResult] = useState<{ ok: boolean; summary: string; steps: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);

  async function run() {
    if (!lead) return setMsg("Pick the lead to send the test to.");
    if (!selectedAccount) return setMsg("Choose the mailbox to send from.");
    const to = lead.email ? `${leadLabel(lead)} (${lead.email})` : leadLabel(lead);
    const ok = await confirm({
      // Name the recipient. "1 lead" tells you the count; it does not tell you
      // who is about to receive real mail.
      title: `Send a test to ${to}?`,
      body: "This sends a real message on your connected channels. It can't be undone.",
      confirmLabel: "Send test",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    setResult(null);
    try {
      const res = await api<{ ok: boolean; summary: string; steps: number }>("/api/agent", {
        body: {
          leadIds: [lead.id],
          brief,
          confidenceThreshold,
          sendingAccountId: selectedAccount || undefined,
        },
        method: "POST",
      });
      setResult(res);
      await mutateDrafts();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolveDraft(id: string, action: "approve" | "discard") {
    setDraftBusy(id);
    try {
      await api("/api/agent/drafts", { method: "PATCH", body: { messageId: id, action } });
      await mutateDrafts();
      toast(action === "approve" ? "Sent." : "Discarded.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setDraftBusy(null);
    }
  }

  return (
    <>
      <DashHeader
        title="Test emails"
        subtitle="Pick one lead, give the agent a brief, and send a single real message to see what lands."
      />
      <div className="grid gap-6 p-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <h2 className="font-display text-lg font-bold">Campaign brief</h2>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_240px]">
              <div>
                <Label>What should the agent say?</Label>
                <Textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} />
              </div>
              <div className="space-y-4">
                <div>
                  <Label>Send from</Label>
                  <Select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
                    <option value="">Select a mailbox…</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.email})
                      </option>
                    ))}
                  </Select>
                  {accounts.length === 0 && (
                    <p className="mt-1.5 text-xs text-danger">
                      No mailbox connected.{" "}
                      <Link href="/dashboard/accounts" className="underline">Connect one</Link> before the agent can email.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Autonomy</Label>
                  <Select value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(Number(e.target.value))}>
                    {CONFIDENCE_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </div>
                <p className="text-xs text-ink-soft">
                  Select a specific verified SMTP sender for emails sent by this Agent execution.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={run}
                disabled={busy || !selectedAccount || !lead}
                className="btn btn-primary disabled:opacity-50"
              >
                <Play className="h-4 w-4" /> {busy ? "Sending…" : "Send test"}
              </button>
              <span className="text-xs text-ink-soft">
                {lead ? (
                  <>
                    to <span className="font-medium text-ink">{leadLabel(lead)}</span>
                  </>
                ) : (
                  "Pick a lead on the right."
                )}
              </span>
            </div>
          </Panel>

          <Banner kind="info">
            This sends a <strong>real message</strong> to one lead, through the same rate-limited path as a
            campaign — nothing here is a simulation. Email must be configured; the agent prefers email and
            only uses other channels when they are set up.
          </Banner>

          {msg && <Banner kind="error">{msg}</Banner>}
          {result && (
            <Panel>
              <h3 className="font-display text-lg font-bold">Result</h3>
              <div className="mt-2 font-mono text-xs text-ink-soft">{result.steps} step(s)</div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{result.summary}</p>
            </Panel>
          )}

          {/* Confidence-gated drafts (product PRD §7) — the agent wrote these but wasn't
              sure enough to send unattended. */}
          {drafts.length > 0 && (
            <Panel>
              <div className="mb-3 flex items-center gap-2">
                <FileEdit className="h-4 w-4" />
                <h3 className="font-display text-lg font-bold">Drafts awaiting approval</h3>
                <span className="font-mono text-xs text-ink-soft">{drafts.length}</span>
              </div>
              <div className="space-y-3">
                {drafts.map((d) => (
                  <div key={d.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {[d.lead.firstName, d.lead.lastName].filter(Boolean).join(" ") || d.lead.email || "Unnamed lead"}
                        </div>
                        <div className="text-xs uppercase tracking-wide text-ink-soft">{d.channel}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => resolveDraft(d.id, "approve")}
                          disabled={draftBusy === d.id}
                          className="rounded-lg bg-ink p-1.5 text-ink-invert hover:opacity-90 disabled:opacity-50"
                          title="Approve & send"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => resolveDraft(d.id, "discard")}
                          disabled={draftBusy === d.id}
                          className="rounded-lg border border-line p-1.5 text-ink-soft hover:bg-tint hover:text-danger disabled:opacity-50"
                          title="Discard"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {d.renderedSubject && <div className="mt-2 text-xs font-medium text-ink-soft">{d.renderedSubject}</div>}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{d.renderedBody}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <Panel className="h-fit">
          <h2 className="font-display text-lg font-bold">Send to</h2>
          <p className="mb-3 mt-0.5 text-xs text-ink-soft">
            One lead at a time. Only leads with an email address are listed.
          </p>
          {/* emailOnly: this screen sends mail, so a lead without an address is
              not a valid choice — offering it only produces a confusing failure. */}
          <LeadPicker value={lead?.id ?? null} onChange={(_, l) => setLead(l)} emailOnly />
        </Panel>
      </div>
    </>
  );
}
