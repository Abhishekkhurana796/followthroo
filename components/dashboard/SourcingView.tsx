"use client";

import { useState } from "react";
import useSWR from "swr";
import { Linkedin, Check, X, Loader2, AlertTriangle, Users } from "lucide-react";
import { api } from "@/lib/client";
import { Badge, Banner, EmptyState, Panel, Skeleton } from "@/components/ui";

type Job = {
  id: string;
  kind: string;
  inputUrl: string;
  status: string;
  progress: number;
  resultCount: number;
  importedAt: string | null;
  importedCount: number;
  failureKind: string | null;
  createdAt: string;
  outcome: string;
};
type Row = {
  profileUrl?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  company?: string;
  title?: string;
  degree?: string;
  reaction?: string;
};
type Detail = Job & { results: Row[]; known: boolean[] };

const KIND_LABEL: Record<string, string> = {
  search_export: "Search",
  profile_scrape: "Profile",
  company_scrape: "Company",
  company_employees: "Employees",
  post_engagers: "Post engagement",
  group_members: "Group",
  event_guests: "Event",
  connections_export: "Connections",
  activity_extract: "Activity",
};

/**
 * Everything that came back from LinkedIn, and the review step before any of it
 * becomes a contact.
 *
 * Lives on the LinkedIn screen, which is the one place sourcing happens. It was
 * briefly mounted on Leads as well, behind ?view=sourcing — a URL nothing in the
 * app ever linked to. That branch is gone. See docs/linkedin-sourcing-ux.md.
 */
export function SourcingView() {
  // Polls while anything is running: the work happens in another tab and the
  // person is watching for it to finish.
  const { data, mutate } = useSWR<{ jobs: Job[] }>("/api/linkedin/scrape", { refreshInterval: 5_000 });
  const [openId, setOpenId] = useState<string | null>(null);

  const jobs = data?.jobs ?? [];

  if (!data) return <Skeleton className="h-64 w-full rounded-2xl" />;

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={Linkedin}
        title="Nothing sourced yet"
        body="Add Lead → Find leads, then paste a LinkedIn search, profile, company, post, group or event. Your browser reads it and the people show up here for review."
      />
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((j) =>
        openId === j.id ? (
          <ReviewPanel key={j.id} jobId={j.id} onClose={() => setOpenId(null)} onImported={() => { setOpenId(null); mutate(); }} />
        ) : (
          <Panel key={j.id} className="!p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{KIND_LABEL[j.kind] ?? j.kind}</Badge>
                  <span className="truncate text-sm font-medium">{j.outcome}</span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{j.inputUrl}</p>
              </div>

              <div className="flex items-center gap-2">
                {j.status === "running" && (
                  <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {j.progress > 0 ? `${j.progress} so far` : "reading…"}
                  </span>
                )}
                {j.status === "queued" && <span className="text-xs text-ink-soft">waiting for your browser</span>}
                {j.importedAt ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check className="h-3.5 w-3.5" /> {j.importedCount} imported
                  </span>
                ) : (
                  j.status === "done" &&
                  j.resultCount > 0 && (
                    <button onClick={() => setOpenId(j.id)} className="btn btn-primary !py-1.5 !px-3 text-xs">
                      Review {j.resultCount}
                    </button>
                  )
                )}
                {j.failureKind === "selector_miss" && (
                  <AlertTriangle className="h-4 w-4 text-warning-strong" aria-label="We could not read that page" />
                )}
              </div>
            </div>
          </Panel>
        ),
      )}
    </div>
  );
}

/**
 * The review step. Nothing imports silently — a mistyped search URL should not
 * put two thousand of the wrong people in the database.
 */
function ReviewPanel({ jobId, onClose, onImported }: { jobId: string; onClose: () => void; onImported: () => void }) {
  const { data } = useSWR<Detail>(`/api/linkedin/scrape?id=${jobId}`);
  // Everything is ticked to start with, except people already in the CRM —
  // re-importing what you have is the one choice nobody means to make.
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <Skeleton className="h-64 w-full rounded-2xl" />;

  const rows = data.results ?? [];
  const known = data.known ?? [];
  const isSkipped = (i: number) => skipped.has(i) || known[i];
  const chosen = rows.map((_, i) => i).filter((i) => !isSkipped(i));
  const knownCount = known.filter(Boolean).length;

  async function importRows() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/linkedin/scrape`, { method: "PATCH", body: { id: jobId, action: "import", rowIndexes: chosen } });
      onImported();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Panel className="ring-2 ring-ink/10">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold">Review before importing</h3>
          <p className="text-xs text-ink-soft">
            {rows.length} found
            {knownCount > 0 && ` · ${knownCount} already in your contacts, unticked`}
          </p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-soft hover:bg-tint" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="max-h-96 overflow-y-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-tint font-mono text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Headline</th>
              <th className="px-3 py-2">Company</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className={isSkipped(i) ? "opacity-40" : ""}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!isSkipped(i)}
                    onChange={() =>
                      setSkipped((s) => {
                        const next = new Set(s);
                        // Un-ticking a known row is already the default; ticking
                        // it back on is a deliberate re-import, which is allowed.
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium">{r.fullName ?? "—"}</span>
                  {known[i] && <span className="ml-2 text-[11px] text-ink-faint">already a contact</span>}
                  {r.degree && <span className="ml-2 font-mono text-[10px] text-ink-faint">{r.degree}</span>}
                </td>
                <td className="max-w-xs truncate px-3 py-2 text-ink-soft">{r.headline ?? r.title ?? "—"}</td>
                <td className="px-3 py-2 text-ink-soft">{r.company ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          Imported contacts are assigned by your LinkedIn source rule.
        </p>
        <button
          onClick={importRows}
          disabled={busy || chosen.length === 0}
          className="btn btn-primary text-sm disabled:opacity-50"
        >
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <><Users className="h-4 w-4" /> Import {chosen.length}</>}
        </button>
      </div>
    </Panel>
  );
}
