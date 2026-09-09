"use client";

import useSWR from "swr";
import { Users } from "lucide-react";
import { Panel, Skeleton } from "@/components/ui";
import { roleLabel } from "@/lib/roles";

type Row = {
  userId: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  leads: number;
  outreach: number;
  replies: number;
  replyRate: number;
  tasksDue: number;
};
type Performance = { days: number; canDrillDown: boolean; rows: Row[] };

/**
 * The owner's view of the team, and the switcher that drills into one person.
 *
 * Selecting somebody sets `?member=<id>`, which every scoped read already
 * understands (lib/scope.ts) — so the drill-down re-scopes the whole dashboard
 * through the same code path a team member's own dashboard uses, rather than
 * being a second parallel rendering of the same data.
 *
 * Renders nothing for a team of one. A performance table with a single row is
 * just your own numbers with extra furniture.
 */
export function TeamPerformance({
  viewAs,
  onViewAs,
}: {
  viewAs: string | null;
  onViewAs: (userId: string | null) => void;
}) {
  const { data, isLoading } = useSWR<Performance>("/api/team/performance");

  if (isLoading) return <Skeleton className="h-56 w-full rounded-2xl" />;
  if (!data || !data.canDrillDown) return null;

  const selected = data.rows.find((r) => r.userId === viewAs) ?? null;

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-bold">
          <Users className="h-4 w-4" /> Team performance
          <span className="font-sans text-xs font-normal text-ink-soft">last {data.days} days</span>
        </h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-ink-soft">View</span>
          <select
            value={viewAs ?? ""}
            onChange={(e) => onViewAs(e.target.value || null)}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium"
          >
            <option value="">All team</option>
            {data.rows.map((r) => (
              <option key={r.userId} value={r.userId}>{r.name}</option>
            ))}
          </select>
        </label>
      </div>

      {selected && (
        <p className="mb-3 rounded-lg bg-tint px-3 py-2 text-xs text-ink-soft">
          Showing {selected.name}&apos;s contacts, tasks and replies across this whole screen.{" "}
          <button onClick={() => onViewAs(null)} className="font-medium underline">
            Back to the whole team
          </button>
        </p>
      )}

      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-soft">
              <th className="px-2 pb-2 font-medium">Member</th>
              <th className="px-2 pb-2 text-right font-medium">Contacts</th>
              <th className="px-2 pb-2 text-right font-medium">Outreach</th>
              <th className="px-2 pb-2 text-right font-medium">Replies</th>
              <th className="px-2 pb-2 text-right font-medium">Reply rate</th>
              <th className="px-2 pb-2 text-right font-medium">Tasks due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => (
              <tr
                key={r.userId}
                onClick={() => onViewAs(viewAs === r.userId ? null : r.userId)}
                className={`cursor-pointer transition hover:bg-tint/60 ${viewAs === r.userId ? "bg-tint" : ""}`}
              >
                <td className="px-2 py-2.5">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-ink-soft">
                    {roleLabel(r.role)}
                    {r.department ? ` · ${r.department}` : ""}
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right font-mono">{r.leads.toLocaleString()}</td>
                <td className="px-2 py-2.5 text-right font-mono">{r.outreach.toLocaleString()}</td>
                <td className="px-2 py-2.5 text-right font-mono">{r.replies.toLocaleString()}</td>
                <td className="px-2 py-2.5 text-right font-mono">{r.replyRate}%</td>
                <td className="px-2 py-2.5 text-right font-mono">{r.tasksDue.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
