"use client";

import { useState } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { Users, Send, MailOpen, MousePointerClick, Reply, TrendingUp, GitBranch, IndianRupee, Timer, Linkedin } from "lucide-react";
import { DashHeader, Panel, Skeleton, Badge } from "@/components/ui";

// recharts is a ~400 KB chunk for two charts below the fold. Loading it lazily
// lets the tiles and tables paint on the first pass; ssr:false because the
// charts measure their container, so there is nothing useful to render server-side.
const ChartFallback = ({ height }: { height: number }) => (
  <div className="p-2" style={{ height }}><Skeleton className="h-full w-full" /></div>
);
const EngagementChart = dynamic(() => import("./ReportsCharts").then((m) => m.EngagementChart), {
  ssr: false,
  loading: () => <ChartFallback height={280} />,
});
const CampaignChart = dynamic(() => import("./ReportsCharts").then((m) => m.CampaignChart), {
  ssr: false,
  loading: () => <ChartFallback height={240} />,
});

type LinkedInReport = {
  invitesSent: number; accepted: number; acceptanceRate: number; awaiting: number;
  alreadyConnected: number; failed: number; messagesSent: number; queued: number;
  byCampaign: { id: string | null; name: string; sent: number; accepted: number; rate: number }[];
  series: { date: string; sent: number; accepted: number }[];
};

type Report = {
  days: number;
  totals: { leads: number; sent: number; opened: number; clicked: number; replied: number; suppressed: number };
  rates: { open: number; click: number; reply: number };
  funnel: { stage: string; count: number }[];
  series: { date: string; sent: number; opened: number; clicked: number; replied: number }[];
  byCampaign: { id: string; name: string; enrolled: number; sent: number; opened: number; replied: number }[];
  pipelineFunnels: {
    pipelineId: string; pipelineName: string; department: string;
    stages: { name: string; position: number; kind: string; count: number }[];
  }[];
  sourceRoi: {
    sourceId: string; key: string; label: string; monthlyCost: number | null;
    totalItems: number; wonItems: number; wonValue: number; costPerWon: number | null;
  }[];
  responseLeaderboard: {
    ownerId: string; ownerName: string | null; ownerEmail: string;
    itemsRespondedTo: number; avgResponseHours: number;
  }[];
  /** Absent in the server-rendered first paint; SWR fills it in. */
  linkedin?: LinkedInReport;
};

// Recharts writes these straight onto SVG paint attributes, which a class
// swap can never reach — but SVG fill/stroke accept var(), so the values stay
// theme-reactive without reading computed styles in an effect (that would
// break SSR and flash on theme change).
const STAGE_ORDER = ["new", "contacted", "replied", "qualified", "won", "lost"];

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <Panel className="!p-5">
      <div className="flex items-center gap-2 text-ink-soft">{icon}<span className="font-mono text-xs uppercase tracking-wide">{label}</span></div>
      <div className="mt-2 font-display text-3xl font-extrabold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </Panel>
  );
}

/** A figure inside a panel — Tile without a panel of its own around it. */
function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="font-mono text-xs uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

/**
 * LinkedIn connection requests — sent, and actually accepted.
 *
 * Reports had no LinkedIn section at all: a request counted as a generic "sent"
 * and an acceptance was never recorded anywhere. "Accepted" here is real — the
 * person has since appeared in the connections list — which is why the footnote
 * says how that is learned rather than letting the number look like more than it is.
 */
function LinkedInPanel({ days, li }: { days: number; li?: LinkedInReport }) {
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Linkedin className="h-4 w-4 text-ink-soft" />
          <h2 className="font-display text-base font-bold">LinkedIn connection requests</h2>
        </div>
        <span className="text-xs text-ink-soft">last {days} days</span>
      </div>

      {!li ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : li.invitesSent === 0 && li.queued === 0 && li.messagesSent === 0 ? (
        <p className="text-sm text-ink-soft">No connection requests sent in this window.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Requests sent" value={li.invitesSent} sub={li.queued ? `${li.queued} more queued` : undefined} />
            <Stat label="Accepted" value={li.accepted} sub={`${li.awaiting} awaiting`} />
            <Stat label="Acceptance rate" value={`${li.acceptanceRate}%`} />
            <Stat
              label="LinkedIn messages"
              value={li.messagesSent}
              sub={li.alreadyConnected ? `${li.alreadyConnected} were already connected` : undefined}
            />
          </div>

          {li.byCampaign.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-wide text-ink-soft">
                    <th className="py-2 pr-3 font-medium">Campaign</th>
                    <th className="py-2 pr-3 text-right font-medium">Sent</th>
                    <th className="py-2 pr-3 text-right font-medium">Accepted</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {li.byCampaign.map((c) => (
                    <tr key={c.id ?? "none"}>
                      <td className="py-2 pr-3">{c.name}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{c.sent}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{c.accepted}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-ink-soft">{c.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-ink-faint">
            LinkedIn doesn&apos;t announce acceptances, so a request counts as accepted once that person appears in your
            connections list — read by the desktop app at the start of a run, or by the Chrome extension on your
            Connections page.{li.failed ? ` ${li.failed} failed to send.` : ""}
          </p>
        </>
      )}
    </Panel>
  );
}

export default function ReportsClient() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useSWR<Report>(`/api/reports?days=${days}`);

  const t = data?.totals;
  const funnel = (data?.funnel ?? []).slice().sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <>
      <DashHeader
        title="Reports"
        subtitle="Outreach performance across your workspace."
        action={
          <div className="flex gap-1 rounded-xl border border-line p-1">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${days === d ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint"}`}>
                {d}d
              </button>
            ))}
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* Tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile icon={<Users className="h-4 w-4" />} label="Leads" value={(t?.leads ?? 0).toLocaleString()} />
          <Tile icon={<Send className="h-4 w-4" />} label="Sent" value={(t?.sent ?? 0).toLocaleString()} sub={`last ${days} days`} />
          <Tile icon={<MailOpen className="h-4 w-4" />} label="Open rate" value={`${data?.rates.open ?? 0}%`} sub={`${(t?.opened ?? 0).toLocaleString()} opened`} />
          <Tile icon={<Reply className="h-4 w-4" />} label="Reply rate" value={`${data?.rates.reply ?? 0}%`} sub={`${(t?.replied ?? 0).toLocaleString()} replied`} />
        </div>

        {/* Engagement over time */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-ink-soft" />
            <h2 className="font-display text-base font-bold">Engagement over time</h2>
          </div>
          {isLoading ? (
            <div className="h-64 p-2"><Skeleton className="h-full w-full" /></div>
          ) : (
            <EngagementChart series={data?.series ?? []} />
          )}
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Funnel */}
          <Panel>
            <h2 className="mb-4 font-display text-base font-bold">Lead funnel</h2>
            <div className="space-y-2.5">
              {funnel.length === 0 && <p className="text-sm text-ink-soft">No leads yet.</p>}
              {funnel.map((f) => (
                <div key={f.stage}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium capitalize">{f.stage}</span>
                    <span className="font-mono text-ink-soft">{f.count.toLocaleString()}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-tint">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${(f.count / maxFunnel) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* By campaign */}
          <Panel>
            <h2 className="mb-4 font-display text-base font-bold">By campaign (sent vs replied)</h2>
            {(data?.byCampaign ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No campaigns yet.</p>
            ) : (
              <CampaignChart rows={(data?.byCampaign ?? []).slice(0, 6)} />
            )}
          </Panel>
        </div>

        {/* Rate strip */}
        <Panel className="!p-5">
          <div className="grid grid-cols-3 divide-x divide-line text-center">
            {[
              { label: "Open rate", value: data?.rates.open ?? 0, icon: <MailOpen className="h-4 w-4" /> },
              { label: "Click rate", value: data?.rates.click ?? 0, icon: <MousePointerClick className="h-4 w-4" /> },
              { label: "Reply rate", value: data?.rates.reply ?? 0, icon: <Reply className="h-4 w-4" /> },
            ].map((r) => (
              <div key={r.label} className="px-4">
                <div className="flex items-center justify-center gap-1.5 text-ink-soft">{r.icon}<span className="font-mono text-xs uppercase">{r.label}</span></div>
                <div className="mt-1 font-display text-2xl font-bold">{r.value}%</div>
              </div>
            ))}
          </div>
        </Panel>

        <LinkedInPanel days={days} li={data?.linkedin} />

        {/* Pipeline funnels — the new Pipeline model, not the legacy Lead.stage above */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-ink-soft" />
            <h2 className="font-display text-base font-bold">Pipeline funnels</h2>
          </div>
          {(data?.pipelineFunnels ?? []).length === 0 ? (
            <p className="text-sm text-ink-soft">No pipelines yet.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              {(data?.pipelineFunnels ?? []).map((p) => {
                const max = Math.max(1, ...p.stages.map((s) => s.count));
                return (
                  <div key={p.pipelineId}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-medium">{p.pipelineName}</span>
                      <Badge tone="neutral" className="capitalize">{p.department}</Badge>
                    </div>
                    <div className="space-y-2">
                      {p.stages.map((s) => (
                        <div key={s.name}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>{s.name}</span>
                            <span className="font-mono text-ink-soft">{s.count}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-tint">
                            <div
                              className={`h-full rounded-full ${s.kind === "won" ? "bg-success" : s.kind === "lost" ? "bg-danger" : "bg-ink"}`}
                              style={{ width: `${(s.count / max) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Cost-per-source ROI */}
          <Panel>
            <div className="mb-4 flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-ink-soft" />
              <h2 className="font-display text-base font-bold">Source ROI</h2>
            </div>
            {(data?.sourceRoi ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No lead sources yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-wide text-ink-soft">
                      <th className="py-2 pr-3 font-medium">Source</th>
                      <th className="py-2 pr-3 text-right font-medium">Leads</th>
                      <th className="py-2 pr-3 text-right font-medium">Won</th>
                      <th className="py-2 text-right font-medium">Cost / win</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(data?.sourceRoi ?? []).map((s) => (
                      <tr key={s.sourceId}>
                        <td className="py-2 pr-3">{s.label}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">{s.totalItems}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">{s.wonItems}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-ink-soft">
                          {s.costPerWon != null ? `₹${s.costPerWon.toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Response-time leaderboard */}
          <Panel>
            <div className="mb-4 flex items-center gap-2">
              <Timer className="h-4 w-4 text-ink-soft" />
              <h2 className="font-display text-base font-bold">Response-time leaderboard</h2>
            </div>
            {(data?.responseLeaderboard ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No responses in this window yet.</p>
            ) : (
              <div className="space-y-2">
                {(data?.responseLeaderboard ?? []).map((r, i) => (
                  <div key={r.ownerId} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink-faint">#{i + 1}</span>
                      <span className="font-medium">{r.ownerName || r.ownerEmail}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono tabular-nums">{r.avgResponseHours}h</span>
                      <span className="ml-1.5 text-xs text-ink-soft">avg · {r.itemsRespondedTo} contacts</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
