"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Inbox as InboxIcon, RefreshCw, Send, Mail, ArrowDownLeft, ArrowUpRight, Rocket, CornerDownRight } from "lucide-react";
import { api } from "@/lib/client";
import { Banner, DashHeader, EmptyState, Skeleton } from "@/components/ui";

type ThreadListItem = {
  id: string;
  status: string;
  subject: string | null;
  channel: string;
  lastMessageAt: string;
  lead: { id: string; firstName: string | null; lastName: string | null; email: string; company: string | null } | null;
  preview: string;
  direction: string | null;
  /** The campaign this conversation belongs to, when one sent or was answered. */
  campaignName: string | null;
};
type Message = {
  id: string;
  direction: string;
  fromAddr: string | null;
  toAddr: string | null;
  subject: string | null;
  body: string | null;
  sentAt: string;
  /** header | thread | address | none — see lib/inbox/store.ts. */
  matchKind: string;
  campaignName: string | null;
  sentByName: string | null;
};
type ThreadDetail = {
  id: string;
  status: string;
  subject: string | null;
  channel: string;
  lead: ThreadListItem["lead"];
  messages: Message[];
  /** WhatsApp and LinkedIn: the campaign that last contacted this person. */
  lastContactedBy: { campaignName: string | null; at: string } | null;
};

/** INBOX_PAGE in lib/queries.ts: a full page means there may be older threads. */
const PAGE = 50;

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "interested", label: "Interested" },
  { key: "not_interested", label: "Not interested" },
  { key: "ooo", label: "Out of office" },
];

const STATUS_ACTIONS: { key: string; label: string }[] = [
  { key: "interested", label: "Interested" },
  { key: "not_interested", label: "Not interested" },
  { key: "ooo", label: "Out of office" },
  { key: "read", label: "Mark read" },
];

function name(lead: ThreadListItem["lead"]) {
  if (!lead) return "Unknown sender";
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email;
}

/**
 * Where a message came from, in words — or null when there is nothing honest to say.
 *
 * Only a reply matched by its headers is called a reply to a campaign. A message
 * that merely came from the same address is a new message, and calling it a
 * reply would claim something that never happened.
 */
function origin(m: Message): string | null {
  if (m.direction === "outbound") {
    if (m.campaignName) return `Sent by campaign “${m.campaignName}”`;
    if (m.sentByName) return `Replied by ${m.sentByName}`;
    return null;
  }
  if (m.campaignName) {
    return m.matchKind === "header"
      ? `Reply to campaign “${m.campaignName}”`
      : `Continues the “${m.campaignName}” conversation`;
  }
  if (m.matchKind === "address") return "New message — not a reply to a campaign";
  return null;
}

export default function InboxClient() {
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  const key = filter ? `/api/inbox?status=${filter}` : "/api/inbox";
  const { data: threads = [], mutate, isLoading } = useSWR<ThreadListItem[]>(key);
  const { data: thread, mutate: mutateThread } = useSWR<ThreadDetail>(openId ? `/api/inbox/${openId}` : null);

  // Pages past the first. The list used to stop at 100 with no way further.
  const [older, setOlder] = useState<ThreadListItem[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const all = [...threads, ...older];
  const canLoadOlder = !olderDone && threads.length >= PAGE;

  async function loadOlder() {
    const last = all[all.length - 1];
    if (!last) return;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ before: last.lastMessageAt });
      if (filter) params.set("status", filter);
      const page = await api<ThreadListItem[]>(`/api/inbox?${params}`);
      setOlder((prev) => [...prev, ...page]);
      if (page.length < PAGE) setOlderDone(true);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ summaries: { account: string; recorded: number; matched: number; error?: string }[] }>("/api/inbox/poll", { method: "POST", body: {} });
      const recorded = res.summaries.reduce((n, s) => n + s.recorded, 0);
      const errs = res.summaries.filter((s) => s.error);
      setMsg(errs.length ? { kind: "info", text: `Polled with issues: ${errs.map((e) => e.error).join("; ")}` } : { kind: "success", text: `Fetched ${recorded} new message(s).` });
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    if (!openId) return;
    await api(`/api/inbox/${openId}`, { method: "PATCH", body: { status } });
    mutate();
    mutateThread();
  }

  async function sendReply() {
    if (!openId || !reply.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/inbox/${openId}`, { body: { body: reply.trim() } });
      setReply("");
      setMsg({ kind: "success", text: "Reply sent." });
      mutateThread();
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DashHeader
        title="Inbox"
        subtitle="Replies across every channel, in one place."
        action={
          <button onClick={refresh} disabled={busy} className="btn btn-ghost !py-2 !text-sm disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />

      <div className="p-6">
        {msg && <div className="mb-4"><Banner kind={msg.kind}>{msg.text}</Banner></div>}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setOpenId(null); setOlder([]); setOlderDone(false); }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === f.key ? "bg-ink text-ink-invert" : "bg-tint text-ink-soft hover:text-ink"}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
          {/* Thread list */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {isLoading ? (
              <div className="divide-y divide-line">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2 px-4 py-3.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-full max-w-[70%]" />
                  </div>
                ))}
              </div>
            ) : all.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title="No conversations yet"
                body="Every reply — email, LinkedIn or WhatsApp — lands here on one thread per lead. Launch a campaign and the first responses show up automatically."
                className="border-0"
              />
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {all.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setOpenId(t.id)}
                        className={`w-full px-4 py-3 text-left transition hover:bg-tint ${openId === t.id ? "bg-tint" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 truncate text-sm font-semibold">
                            {t.status === "unread" && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                            {name(t.lead)}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-ink-soft">{new Date(t.lastMessageAt).toLocaleDateString()}</span>
                        </div>
                        <div className="truncate text-xs text-ink-soft">{t.subject || "(no subject)"}</div>
                        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-soft/80">
                          {t.direction === "inbound" ? <ArrowDownLeft className="h-3 w-3 text-success" /> : <ArrowUpRight className="h-3 w-3" />}
                          {t.preview}
                        </div>
                        {t.campaignName && (
                          <div className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[10px] font-medium text-ink-soft">
                            <Rocket className="h-3 w-3 shrink-0" />
                            <span className="truncate">{t.campaignName}</span>
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {canLoadOlder && (
                  <div className="border-t border-line p-3 text-center">
                    <button onClick={loadOlder} disabled={loadingOlder} className="btn btn-ghost !py-1.5 !text-xs disabled:opacity-50">
                      {loadingOlder ? "Loading…" : "Load older conversations"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Thread detail */}
          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
            {!thread ? (
              <div className="grid flex-1 place-items-center p-10 text-center text-sm text-ink-soft">
                <div>
                  <Mail className="mx-auto h-10 w-10 text-ink-faint" />
                  <p className="mt-3">Select a conversation.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                  <div className="min-w-0">
                    <div className="font-display font-bold">{name(thread.lead)}</div>
                    <div className="text-xs text-ink-soft">{thread.lead?.email} {thread.lead?.company ? `· ${thread.lead.company}` : ""}</div>
                    {/* Channels with no reply headers cannot prove what a message
                        answers; saying who last reached out is the honest part. */}
                    {thread.lastContactedBy?.campaignName && (
                      <div suppressHydrationWarning className="mt-1 flex items-center gap-1 text-xs text-ink-soft">
                        <Rocket className="h-3 w-3" /> Last contacted by campaign “{thread.lastContactedBy.campaignName}” on{" "}
                        {new Date(thread.lastContactedBy.at).toLocaleDateString()}
                      </div>
                    )}
                    {/* The conversation is half the picture; the record is the other half. */}
                    {thread.lead && (
                      <Link
                        href={`/dashboard/leads/${thread.lead.id}`}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        Open lead <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_ACTIONS.map((a) => (
                      <button
                        key={a.key}
                        onClick={() => setStatus(a.key)}
                        className={`rounded-lg px-2.5 py-1 text-xs transition ${thread.status === a.key ? "bg-ink text-ink-invert" : "bg-tint text-ink-soft hover:text-ink"}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-5">
                  {thread.messages.map((m) => {
                    const from = origin(m);
                    const inbound = m.direction === "inbound";
                    return (
                      <div key={m.id} className={`max-w-[80%] rounded-2xl border px-4 py-2.5 text-sm ${inbound ? "border-line bg-tint" : "ml-auto border-ink bg-ink text-ink-invert"}`}>
                        {from && (
                          <div className={`mb-1 flex items-center gap-1 text-[11px] font-medium ${inbound ? "text-ink-soft" : "text-ink-invert/70"}`}>
                            <CornerDownRight className="h-3 w-3 shrink-0" /> {from}
                          </div>
                        )}
                        {m.subject && <div className={`mb-1 text-xs font-semibold ${inbound ? "text-ink-soft" : "text-ink-invert/70"}`}>{m.subject}</div>}
                        <div className="whitespace-pre-wrap">{(m.body ?? "").replace(/<[^>]+>/g, " ")}</div>
                        <div className={`mt-1 text-[10px] ${inbound ? "text-ink-soft" : "text-ink-invert/60"}`}>{new Date(m.sentAt).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-line p-3">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Write a reply…"
                      rows={2}
                      className="flex-1 resize-none rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:border-ink"
                    />
                    <button onClick={sendReply} disabled={busy || !reply.trim()} className="btn btn-primary !py-2.5 disabled:opacity-50">
                      <Send className="h-4 w-4" /> Send
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
