"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Send, Mail, MessageSquare, Linkedin, Rocket, User, Bot, type LucideIcon } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/cn";
import { Badge, Banner, DashHeader, EmptyState, Select, Skeleton } from "@/components/ui";

type Lead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  linkedinUrl: string | null;
};
type MessageRow = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  preview: string;
  at: string;
  campaign: { id: string; name: string } | null;
  /** A member's name, "AI agent", or null when a campaign sent it. */
  sentBy: string | null;
  lead: Lead;
};
type InviteRow = {
  id: string;
  state: string;
  note: string | null;
  result: string | null;
  queuedAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  campaign: { id: string; name: string } | null;
  lead: Lead;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type Campaign = { id: string; name: string };
type Tab = "messages" | "invites";
type Tone = "success" | "accent" | "neutral" | "danger";

const who = (l: Lead) => [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed lead";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

const CHANNEL: Record<string, { label: string; icon: LucideIcon }> = {
  email: { label: "Email", icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageSquare },
  linkedin: { label: "LinkedIn message", icon: Linkedin },
};

const MESSAGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Sent", tone: "neutral" },
  delivered: { label: "Delivered", tone: "neutral" },
  replied: { label: "Replied", tone: "success" },
  bounced: { label: "Bounced", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

const INVITE_STATE: Record<string, { label: string; tone: Tone }> = {
  accepted: { label: "Accepted", tone: "success" },
  sent: { label: "Sent — awaiting", tone: "accent" },
  queued: { label: "Queued", tone: "neutral" },
  waiting: { label: "Waiting for you to send", tone: "accent" },
  already_connected: { label: "Already connected", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

/**
 * The Outbox: what went out, and what sent it.
 *
 * Two tabs because they are two different things. A message can be replied to,
 * and its outcome is immediate. A connection request cannot be replied to, and
 * its outcome — accepted or not — arrives days later, which is why that tab is
 * built around it.
 */
export default function OutboxClient() {
  const [tab, setTab] = useState<Tab>("messages");
  const [channel, setChannel] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const { data: campaigns = [] } = useSWR<Campaign[]>("/api/campaigns");

  const params = new URLSearchParams({ tab });
  if (campaignId) params.set("campaignId", campaignId);
  if (tab === "messages" && channel) params.set("channel", channel);
  if (tab === "invites" && inviteStatus) params.set("status", inviteStatus);
  const key = `/api/outbox?${params}`;

  // Not keepPreviousData: showing the last tab's rows under the new tab's columns
  // for a moment would render messages as invitations.
  const { data: first, isLoading, error } = useSWR<Page<MessageRow | InviteRow>>(key, { keepPreviousData: false });

  const [more, setMore] = useState<(MessageRow | InviteRow)[]>([]);
  /** undefined until "Load older" has been used for this list. */
  const [moreCursor, setMoreCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // A new tab or filter is a new list.
  useEffect(() => {
    setMore([]);
    setMoreCursor(undefined);
  }, [key]);

  const next = moreCursor === undefined ? (first?.nextCursor ?? null) : moreCursor;
  const rows = [...(first?.items ?? []), ...more];

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    setMsg(null);
    try {
      const page = await api<Page<MessageRow | InviteRow>>(`${key}&cursor=${encodeURIComponent(next)}`);
      setMore((prev) => [...prev, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: "messages", label: "Messages sent", icon: Send },
    { key: "invites", label: "LinkedIn invites", icon: Linkedin },
  ];

  return (
    <>
      <DashHeader title="Outbox" subtitle="Everything that went out, and what sent it." />

      <div className="space-y-4 p-8">
        {(msg || error) && <Banner kind="error">{msg ?? (error as Error).message}</Banner>}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-line p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  tab === t.key ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint",
                )}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {tab === "messages" ? (
            <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel" className="!w-44 !py-2 text-sm">
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="linkedin">LinkedIn messages</option>
            </Select>
          ) : (
            <Select value={inviteStatus} onChange={(e) => setInviteStatus(e.target.value)} aria-label="Status" className="!w-44 !py-2 text-sm">
              <option value="">Every status</option>
              <option value="accepted">Accepted</option>
              <option value="sent">Sent, awaiting</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
            </Select>
          )}

          <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign" className="!w-56 !py-2 text-sm">
            <option value="">Every campaign</option>
            <option value="none">{tab === "messages" ? "Not from a campaign" : "From the Leads screen"}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-tint font-mono text-xs uppercase tracking-wide text-ink-soft">
              {tab === "messages" ? (
                <tr>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Sent by</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Accepted</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {Array.from({ length: 5 }).map((__, c) => (
                      <td key={c} className="px-4 py-3"><Skeleton className={`h-3.5 ${c === 1 ? "w-48" : "w-24"}`} /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10">
                    <EmptyState
                      icon={tab === "messages" ? Send : Linkedin}
                      title={tab === "messages" ? "Nothing sent yet" : "No connection requests yet"}
                      body={
                        tab === "messages"
                          ? "Emails, WhatsApp and LinkedIn messages appear here as they go out — from campaigns, from the AI agent, and replies you type in the Inbox."
                          : "Connection requests appear here from the moment a campaign queues them, and show when each one is accepted."
                      }
                      className="border-0 bg-transparent py-0"
                    />
                  </td>
                </tr>
              ) : tab === "messages" ? (
                (rows as MessageRow[]).map((r) => {
                  const ch = CHANNEL[r.channel] ?? { label: r.channel, icon: Send };
                  const st = MESSAGE_STATUS[r.status] ?? { label: r.status, tone: "neutral" as Tone };
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/leads/${r.lead.id}`} className="font-medium hover:text-accent hover:underline">
                          {who(r.lead)}
                        </Link>
                        {r.lead.company && <div className="text-xs text-ink-soft">{r.lead.company}</div>}
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-ink-faint">
                          <ch.icon className="h-3.5 w-3.5" /> {ch.label}
                        </div>
                        {r.subject && <div className="truncate font-medium">{r.subject}</div>}
                        <div className="truncate text-xs text-ink-soft">{r.preview || "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.campaign ? (
                          <span className="inline-flex items-center gap-1 text-ink">
                            <Rocket className="h-3.5 w-3.5 text-ink-faint" /> {r.campaign.name}
                          </span>
                        ) : r.sentBy === "AI agent" ? (
                          <span className="inline-flex items-center gap-1 text-ink-soft">
                            <Bot className="h-3.5 w-3.5" /> AI agent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-ink-soft">
                            <User className="h-3.5 w-3.5" /> {r.sentBy ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td suppressHydrationWarning className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-soft">{when(r.at)}</td>
                    </tr>
                  );
                })
              ) : (
                (rows as InviteRow[]).map((r) => {
                  const st = INVITE_STATE[r.state] ?? { label: r.state, tone: "neutral" as Tone };
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/leads/${r.lead.id}`} className="font-medium hover:text-accent hover:underline">
                          {who(r.lead)}
                        </Link>
                        {r.lead.company && <div className="text-xs text-ink-soft">{r.lead.company}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.campaign ? (
                          <span className="inline-flex items-center gap-1 text-ink">
                            <Rocket className="h-3.5 w-3.5 text-ink-faint" /> {r.campaign.name}
                          </span>
                        ) : (
                          <span className="text-ink-soft">From the Leads screen</span>
                        )}
                        {r.note && <div className="mt-1 max-w-xs truncate text-ink-faint" title={r.note}>“{r.note}”</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.state === "failed" && r.result && <div className="mt-1 max-w-xs text-xs text-ink-soft">{r.result}</div>}
                      </td>
                      <td suppressHydrationWarning className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-soft">{when(r.sentAt)}</td>
                      <td suppressHydrationWarning className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-soft">{when(r.acceptedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {next && (
          <div className="flex justify-center">
            <button onClick={loadMore} disabled={loadingMore} className="btn btn-ghost !py-2 !text-sm disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          </div>
        )}

        {tab === "invites" && (
          <p className="text-xs text-ink-faint">
            LinkedIn doesn&apos;t announce an accepted invitation. It is marked accepted when that person shows up in your
            connections list — read by the desktop app at the start of each run, or by the Chrome extension whenever you
            open your Connections page.
          </p>
        )}
      </div>
    </>
  );
}
