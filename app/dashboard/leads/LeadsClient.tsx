"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import {
  Trash2, Upload, Plus, Tag, FolderPlus, X, Pencil, Check, Users, Linkedin,
  AlertTriangle, CircleDot, Search, ArrowRight, Building2, Download, IdCard,
} from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/cn";
import { Badge, Banner, DashHeader, Dialog, EmptyState, Input, Label, NoResults, Panel, Select, Skeleton, Textarea, useConfirm, usePrompt } from "@/components/ui";
import { INVITE_NOTE_MAX, worstCaseNoteLength } from "@/lib/linkedin/note";
import { CREDIT_COSTS } from "@/lib/billing/plans";
import { SUMMARY_KEY, type Summary } from "@/components/dashboard/billing/types";
import { tourTarget } from "@/components/dashboard/tour/target";
type NextAction = { taskId: string | null; label: string; kind: string; dueAt: string | null; urgent: boolean; source: string };
type Lead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  linkedinUrl: string | null;
  company: string | null;
  stage: string;
  tags: string[];
  score: number | null;
  source: string | null;
  ownerId: string | null;
  ownerName: string | null;
  /** Who added the contact, as a name. Null when a source added it, not a person. */
  createdByName: string | null;
  /** user | import | extension | linkedin_bulk | webhook | ai */
  createdKind: string;
  lastActivityAt: string | null;
  nextAction: NextAction | null;
};

type LeadsResponse = { items: Lead[]; total: number; page: number; pageSize: number; totalPages: number };
type Assignees = { self: string; members: { userId: string; name: string; email: string | null; isSelf: boolean }[] };
type Segment = { id: string; name: string; kind: string; count: number; leadIds: string[] };
type Campaign = { id: string; name: string };
type ImportResult = { imported: number; skipped: number; errors?: string[] };
type LeadSource = { key: string; label: string };

const PAGE_SIZE = 50;

/**
 * What CSV and Excel imports understand, shown in the Add Lead dialog.
 *
 * "What columns does the CSV need?" was a question the screen could not answer:
 * the only way to find out was to upload a file and read the skip count. Mirrors
 * normalizeRow in app/api/leads/import/route.ts — keep the two in step. Headers
 * match case- and space-insensitively, so "First Name" and "firstname" are equal.
 */
const IMPORT_COLUMNS: { column: string; aliases?: string; note?: string }[] = [
  { column: "email", note: "Also how duplicates are spotted" },
  { column: "linkedin url", aliases: "linkedin, linkedin profile, profile url", note: "Enough on its own — no email needed" },
  { column: "first name", aliases: "name (split into first and last)" },
  { column: "last name" },
  { column: "company" },
  { column: "title" },
  { column: "phone" },
  { column: "tags", note: "Several at once, separated by commas" },
];

const SAMPLE_CSV = [
  "first name,last name,email,linkedin url,company,title,phone,tags,city",
  'Priya,Shah,priya@acme.com,https://www.linkedin.com/in/priyashah,Acme,Head of HR,+91 98765 43210,"warm,hr",Mumbai',
  "Arjun,Mehta,,https://www.linkedin.com/in/arjun-mehta,Globex,Talent Lead,,linkedin,Pune",
].join("\n");

/** Where a contact came from, as a person reads it: "Priya · CSV", "IndiaMART". */
function addedBy(l: Lead): string {
  const how: Record<string, string> = { import: "CSV", extension: "Extension", linkedin_bulk: "LinkedIn" };
  if (l.createdByName) return how[l.createdKind] ? `${l.createdByName} · ${how[l.createdKind]}` : l.createdByName;
  if (l.createdKind === "ai") return "AI agent";
  // Nobody added it: a source did (a webhook, a polled inbox).
  return l.source ?? "Automatic";
}

const displayName = (l: Lead) => [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed lead";

function ago(iso: string | null) {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export default function LeadsPage() {
  const [page, setPage] = useState(1);
  const [book, setBook] = useState<"" | "linkedin">(""); // "" = all leads, "linkedin" = has a profile URL
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", email: "", company: "", tags: "", linkedinUrl: "" });
  const [busy, setBusy] = useState(false);
  const [managingGroup, setManagingGroup] = useState<Segment | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // ?view=unassigned is a distinct view, not a filter: those contacts are
  // outside everyone's scope by design, so the server treats it as its own
  // query and refuses it for anyone who is not an owner, admin or manager.
  const view = useSearchParams().get("view");
  const unassignedView = view === "unassigned";

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (unassignedView) params.set("view", "unassigned");
  if (book) params.set("book", book);
  if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
  if (tagFilter.length) params.set("tags", tagFilter.join(","));
  if (groupFilter) params.set("group", groupFilter);
  if (stageFilter) params.set("stage", stageFilter);
  if (ownerFilter) params.set("owner", ownerFilter);
  if (sourceFilter) params.set("source", sourceFilter);
  const { data, isLoading, error, mutate } = useSWR<LeadsResponse>(`/api/leads?${params}`);
  const { data: segments, mutate: mutateSegments } = useSWR<Segment[]>("/api/segments");
  const { data: campaigns } = useSWR<Campaign[]>("/api/campaigns");
  const { data: sources } = useSWR<LeadSource[]>("/api/lead-sources");
  const { data: billing } = useSWR<Summary>(SUMMARY_KEY);
  // Who this person may hand contacts to. Same source as task assignment, so the
  // two can never disagree about who reports to whom.
  const { data: assignees } = useSWR<Assignees>("/api/tasks/assignees");
  const confirm = useConfirm();
  const prompt = usePrompt();

  const leads = data?.items ?? [];
  const total = data?.total ?? 0;
  // Distinguishes "you have no leads" from "your filters match nothing" —
  // they need different copy and a different action.
  const hasFilters = !!(debouncedSearch.trim() || tagFilter.length || groupFilter || book || stageFilter || ownerFilter || sourceFilter);
  const totalPages = data?.totalPages ?? 1;
  const enrichmentLocked = !!billing?.enforced && !billing.plan?.features.includes("linkedin_enrichment");

  // All tags seen on the current page (for quick filter chips).
  const pageTags = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => l.tags?.forEach((t) => s.add(t)));
    tagFilter.forEach((t) => s.add(t));
    return Array.from(s).sort();
  }, [leads, tagFilter]);

  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (leads.every((l) => prev.has(l.id))) {
        const next = new Set(prev);
        leads.forEach((l) => next.delete(l.id));
        return next;
      }
      return new Set([...prev, ...leads.map((l) => l.id)]);
    });
  }

  // Who a new contact goes to. Empty means "let the source's rule decide" — for a
  // manual add, that is whoever is adding it.
  const [newOwnerId, setNewOwnerId] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  async function addLead(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.trim() && !form.linkedinUrl.trim()) {
      return setMsg({ kind: "error", text: "Add an email or a LinkedIn URL." });
    }
    setBusy(true);
    setMsg(null);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const saved = await api<{ id: string; created: boolean }>("/api/leads", {
        body: {
          firstName: form.firstName || undefined,
          email: form.email.trim() || undefined,
          linkedinUrl: form.linkedinUrl.trim() || undefined,
          company: form.company || undefined,
          tags,
          ...(newOwnerId ? { ownerId: newOwnerId } : {}),
        },
      });
      setForm({ firstName: "", email: "", company: "", tags: "", linkedinUrl: "" });
      setNewOwnerId("");
      setAddOpen(false);
      // An existing address is updated in place and keeps its original position
      // in the newest-first list, so "Lead added" would send someone hunting for
      // a new row at the top that was never going to be there.
      setMsg(
        saved.created
          ? { kind: "success", text: "Lead added." }
          : { kind: "info", text: "That contact already existed — we updated it instead of adding a duplicate." },
      );
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setMsg(null);
    setImportResult(null);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      let res: ImportResult;
      if (isXlsx) {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/leads/import", { method: "POST", body: form });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.error ?? "Could not import the Excel workbook.");
        res = body.data as ImportResult;
      } else {
        const text = await file.text();
        res = await api<ImportResult>("/api/leads/import", { raw: text, contentType: "text/csv" });
      }
      // Shown in the dialog, beside the column list: "skipped 3" is only useful
      // next to the reasons and the rules those rows broke.
      setImportResult(res);
      // The import succeeded but the previous view may have been LinkedIn-only,
      // an owner/source filter, or page 4. Put the new rows in view immediately
      // rather than leaving a truthful "Imported 4" beside an empty table.
      setPage(1);
      setBook("");
      setSearch("");
      setDebouncedSearch("");
      setTagFilter([]);
      setGroupFilter("");
      setStageFilter("");
      setOwnerFilter("");
      setSourceFilter("");
      mutate();
    } catch (e) {
      setImportResult({ imported: 0, skipped: 0, errors: [(e as Error).message] });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function exportCsv() {
    setMsg(null);
    try {
      const query = new URLSearchParams(params);
      query.delete("page");
      query.delete("pageSize");
      const res = await fetch(`/api/leads/export?${query.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not export leads.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "followthroo-leads.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  /** Assign one contact from its row — the same endpoint, and rule, as the lead's own page. */
  async function assignOne(l: Lead, ownerId: string) {
    const value = ownerId || null;
    if (value === l.ownerId) return;
    setMsg(null);
    try {
      await api(`/api/leads/${l.id}`, { method: "PATCH", body: { ownerId: value } });
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function del(id: string) {
    const ok = await confirm({
      title: "Delete this lead?",
      body: "They'll be added to the suppression list, so no campaign can reach them again.",
      confirmLabel: "Delete lead",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/leads/${id}`, { method: "DELETE" });
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  // ---- Bulk actions on the current selection ----
  const selectedIds = () => Array.from(selected);

  /**
   * Hand the selected contacts to a teammate.
   *
   * Options come from /api/tasks/assignees, which already encodes who you may
   * give work to — owners and admins anyone, a manager their department, and
   * everyone else only themselves. Reusing it means assignment cannot drift
   * from task assignment, and the server re-checks it anyway.
   */
  async function bulkAssign(ownerId: string) {
    const value = ownerId === "__unassign" ? null : ownerId;
    try {
      await api("/api/leads/bulk", { body: { leadIds: [...selected], ownerId: value } });
      setMsg({
        kind: "success",
        text: value
          ? `Assigned ${selected.size} contact(s).`
          : `Returned ${selected.size} contact(s) to the team pool.`,
      });
      setSelected(new Set());
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function bulkAddTag() {
    const tag = await prompt({
      title: `Tag ${selected.size} lead${selected.size === 1 ? "" : "s"}`,
      label: "Tag",
      placeholder: "warm-lead",
      confirmLabel: "Add tag",
    });
    if (!tag) return;
    await api("/api/leads/bulk", { body: { leadIds: selectedIds(), addTags: [tag] } });
    setMsg({ kind: "success", text: `Tagged ${selected.size} lead(s) “${tag}”.` });
    mutate();
  }

  async function bulkAddToGroup(segmentId: string) {
    if (!segmentId) return;
    await api("/api/leads/bulk", { body: { leadIds: selectedIds(), segmentId } });
    setMsg({ kind: "success", text: `Added ${selected.size} lead(s) to group.` });
    mutateSegments();
  }

  async function bulkEnroll(campaignId: string) {
    if (!campaignId) return;
    const ok = await confirm({
      title: `Enroll ${selected.size} lead${selected.size === 1 ? "" : "s"}?`,
      body: "They'll start receiving this campaign's sequence on its normal schedule.",
      confirmLabel: "Enroll",
    });
    if (!ok) return;
    try {
      const res = await api<{ enrolled: number; skipped: number }>(`/api/campaigns/${campaignId}/enroll`, {
        body: { leadIds: selectedIds() },
      });
      setMsg({ kind: "success", text: `Enrolled ${res.enrolled}, skipped ${res.skipped} already in campaign.` });
      setSelected(new Set());
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  /**
   * "Find email and phone" for the selection. Estimated first — the dialog
   * says how many of the selected leads a lookup would actually run for
   * (a 1st-degree connection with a LinkedIn URL) before anything is queued,
   * since most of a batch selected from a search often isn't.
   */
  async function bulkEnrich() {
    if (enrichmentLocked) {
      setMsg({ kind: "info", text: "LinkedIn profile enrichment is available on Grow and Scale." });
      return;
    }
    const est = await api<{ eligible: number; noLinkedIn: number; optedOut: number; alreadyQueued: number }>(
      "/api/linkedin/enrich?estimate=1",
      { body: { leadIds: selectedIds() } },
    );
    if (est.eligible === 0) {
      setMsg({ kind: "error", text: "None of the selected leads have a LinkedIn URL to look up." });
      return;
    }
    const ok = await confirm({
      title: `Find email and phone for ${est.eligible} lead${est.eligible === 1 ? "" : "s"}?`,
      body: [
        "Up to 3 credits each, with 1 back for each of email or phone LinkedIn doesn't show — free for anyone who isn't a 1st-degree connection yet.",
        est.noLinkedIn ? `${est.noLinkedIn} of the selected have no LinkedIn URL and are left out.` : null,
        est.alreadyQueued ? `${est.alreadyQueued} already have a lookup queued.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: `Look up ${est.eligible}`,
    });
    if (!ok) return;
    try {
      const res = await api<{ queued: number; skipped: number }>("/api/linkedin/enrich", { body: { leadIds: selectedIds() } });
      setMsg({ kind: "success", text: `Queued ${res.queued} for the desktop app to look up.` });
      setSelected(new Set());
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function createGroupFromTag(tag: string) {
    // Collect all lead IDs that have this tag from the current page
    const tagLeads = leads.filter((l) => l.tags?.includes(tag)).map((l) => l.id);
    await api("/api/segments", { body: { name: tag, kind: "static", leadIds: tagLeads } });
    setMsg({ kind: "success", text: `Group "${tag}" created with ${tagLeads.length} lead(s) from this page.` });
    mutateSegments();
  }

  return (
    <>
      <DashHeader
        title={unassignedView ? "Unassigned leads" : "Leads"}
        subtitle={
          unassignedView
            ? `${total.toLocaleString()} waiting for an owner — nobody sees these until they are assigned`
            : `${total.toLocaleString()} in your list`
        }
        action={
          <div className="flex items-center gap-2">
            {unassignedView ? (
              <Link href="/dashboard/leads" className="btn btn-ghost !py-2 !text-sm">
                Back to my leads
              </Link>
            ) : (
              <>
                {/* Companies lost its rail row: it is a way of looking at these
                    same leads, grouped, rather than a separate thing. It keeps
                    its screen, reached from here. */}
                <Link href="/dashboard/companies" className="btn btn-ghost !py-2 !text-sm">
                  <Building2 className="h-4 w-4" /> Companies
                </Link>
                <button onClick={() => setGroupsOpen(true)} className="btn btn-ghost !py-2 !text-sm">
                  <FolderPlus className="h-4 w-4" /> Groups
                </button>
                <button onClick={exportCsv} className="btn btn-ghost !py-2 !text-sm">
                  <Download className="h-4 w-4" /> Export CSV
                </button>
              </>
            )}
            <button {...tourTarget("leads-import")} onClick={() => setAddOpen(true)} className="btn btn-primary !py-2 !text-sm">
              <Plus className="h-4 w-4" /> Add Lead
            </button>
          </div>
        }
      />

      {/* The import picker lives outside the dialog so closing the dialog on click
          doesn't unmount the input mid-selection. */}
      <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />

      <div className="space-y-4 p-8">
        {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : error ? <Banner kind="error">{(error as Error).message}</Banner> : null}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-line p-1">
            <button
              onClick={() => { setBook(""); setPage(1); setSelected(new Set()); }}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition", book === "" ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint")}
            >
              All leads
            </button>
            <button
              onClick={() => { setBook("linkedin"); setPage(1); setSelected(new Set()); }}
              className={cn("flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition", book === "linkedin" ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint")}
            >
              <Linkedin className="h-3.5 w-3.5" /> LinkedIn only
            </button>
          </div>
          <Select value={groupFilter} onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }} className="!w-52 !py-2 text-sm">
            <option value="">All groups</option>
            {(segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
          </Select>
          <Select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }} className="!w-40 !py-2 text-sm">
            <option value="">All stages</option>
            <option value="new">New</option><option value="contacted">Contacted</option><option value="replied">Replied</option>
            <option value="qualified">Qualified</option><option value="won">Won</option><option value="lost">Lost</option>
          </Select>
          <Select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setPage(1); }} className="!w-44 !py-2 text-sm">
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {assignees?.members.map((member) => <option key={member.userId} value={member.userId}>{member.isSelf ? `${member.name} (me)` : member.name}</option>)}
          </Select>
          <Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }} className="!w-44 !py-2 text-sm">
            <option value="">All sources</option>
            {sources?.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
          </Select>
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, or company…" className="!pl-9" />
          </div>
        </div>

        {/* Tag filter chips */}
        {pageTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs uppercase text-ink-soft">Tags:</span>
            {pageTags.map((t) => {
              const on = tagFilter.includes(t);
              const alreadyGroup = (segments ?? []).some((s) => s.name === t);
              return (
                <div key={t} className="flex items-center gap-0.5">
                  <button
                    onClick={() => { setPage(1); setTagFilter((f) => (on ? f.filter((x) => x !== t) : [...f, t])); }}
                    className={cn("flex items-center gap-1 rounded-l-full px-2.5 py-1 text-xs transition", on ? "bg-ink text-ink-invert" : "bg-tint text-ink-soft hover:text-ink")}
                  >
                    <Tag className="h-3 w-3" /> {t} {on && <X className="h-3 w-3" />}
                  </button>
                  {!alreadyGroup && (
                    <button
                      onClick={() => createGroupFromTag(t)}
                      title={`Create group "${t}"`}
                      className="rounded-r-full bg-tint px-1.5 py-1 text-xs text-ink-soft transition hover:bg-accent-soft hover:text-accent"
                    >
                      <FolderPlus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink bg-ink px-4 py-2.5 text-sm text-ink-invert">
            <span className="font-medium">{selected.size} selected</span>
            <button onClick={bulkAddTag} className="flex items-center gap-1 rounded-lg bg-ink-invert/15 px-2.5 py-1 hover:bg-ink-invert/25">
              <Tag className="h-3.5 w-3.5" /> Add tag
            </button>
            <Select onChange={(e) => { bulkAddToGroup(e.target.value); e.target.value = ""; }} className="!w-40 !bg-ink-invert/15 !text-ink-invert !border-ink-invert/20 !py-1 text-xs" defaultValue="">
              <option value="" className="text-ink">Add to group…</option>
              {(segments ?? []).map((s) => <option key={s.id} value={s.id} className="text-ink">{s.name}</option>)}
            </Select>
            <Select onChange={(e) => { bulkEnroll(e.target.value); e.target.value = ""; }} className="!w-44 !bg-ink-invert/15 !text-ink-invert !border-ink-invert/20 !py-1 text-xs" defaultValue="">
              <option value="" className="text-ink">Enroll in campaign…</option>
              {(campaigns ?? []).map((c) => <option key={c.id} value={c.id} className="text-ink">{c.name}</option>)}
            </Select>
            <Select onChange={(e) => { bulkAssign(e.target.value); e.target.value = ""; }} className="!w-44 !bg-ink-invert/15 !text-ink-invert !border-ink-invert/20 !py-1 text-xs" defaultValue="">
              <option value="" className="text-ink">Assign to…</option>
              {(assignees?.members ?? []).map((a) => <option key={a.userId} value={a.userId} className="text-ink">{a.isSelf ? `${a.name} (me)` : a.name}</option>)}
              <option value="__unassign" className="text-ink">Unassign (team pool)</option>
            </Select>
            {/* The fast path. Building a campaign is the right tool for a
                sequence; for "invite these forty" it was five steps too many,
                and there was no other way to do it from the app at all. */}
            <button
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-ink-invert/15 px-2.5 py-1 hover:bg-ink-invert/25"
            >
              <Linkedin className="h-3.5 w-3.5" /> Connect on LinkedIn
              <span className="font-mono text-[10px] text-ink-invert/60">{CREDIT_COSTS.li_invite}+ credits each</span>
            </button>
            {enrichmentLocked ? (
              <Link href="/dashboard/settings/billing" className="flex items-center gap-1 rounded-lg bg-ink-invert/15 px-2.5 py-1 hover:bg-ink-invert/25">
                <IdCard className="h-3.5 w-3.5" /> Upgrade for profile lookup
              </Link>
            ) : (
            <button
              onClick={bulkEnrich}
              title={`Up to ${CREDIT_COSTS.enrich} credits each — refunded for anything not found, free if not a 1st-degree connection`}
              className="flex items-center gap-1 rounded-lg bg-ink-invert/15 px-2.5 py-1 hover:bg-ink-invert/25"
            >
              <IdCard className="h-3.5 w-3.5" /> Find email &amp; phone
              <span className="font-mono text-[10px] text-ink-invert/60">up to {CREDIT_COSTS.enrich} each</span>
            </button>
            )}
            <button onClick={() => setSelected(new Set())} className="ml-auto text-ink-invert/70 hover:text-ink-invert">Clear</button>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-tint font-mono text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Added by</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3">Next action</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                // Skeleton rows rather than a "Loading…" string: the table keeps
                // its height, so nothing below it jumps when the data lands.
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-4" /></td>
                    {Array.from({ length: 9 }).map((__, c) => (
                      <td key={c} className="px-4 py-3"><Skeleton className={`h-3.5 ${c === 0 ? "w-32" : "w-20"}`} /></td>
                    ))}
                  </tr>
                ))
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10">
                    {hasFilters ? (
                      <NoResults
                        query={debouncedSearch.trim() || undefined}
                        onClear={() => { setSearch(""); setTagFilter([]); setGroupFilter(""); setStageFilter(""); setOwnerFilter(""); setSourceFilter(""); setBook(""); setPage(1); }}
                      />
                    ) : (
                      <EmptyState
                        icon={Users}
                        title="No leads yet"
                        body="Leads are everyone you're trying to reach. Import a CSV, add one by hand, or connect a lead source and they'll arrive on their own."
                        action={<button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> Add Lead</button>}
                        className="border-0 bg-transparent py-0"
                      />
                    )}
                  </td>
                </tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id} className={cn("transition-colors hover:bg-tint/40", selected.has(l.id) && "bg-tint/50")}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${displayName(l)}`} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leads/${l.id}`} className="font-medium hover:text-accent hover:underline">
                        {displayName(l)}
                      </Link>
                      {l.email && <div className="truncate text-xs text-ink-soft">{l.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{l.company ?? "—"}</td>
                    <td className="px-4 py-3">
                      {l.source ? <Badge tone="neutral">{l.source}</Badge> : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-tint px-2 py-0.5 font-mono text-xs">{l.stage}</span></td>
                    <td className="px-4 py-3">
                      {/* One contact at a time, without selecting it first — the
                          bulk bar was the only way, and nobody found it. Shown only
                          when there is someone to choose; the server re-checks. */}
                      {(assignees?.members.length ?? 0) > 1 ? (
                        <Select
                          value={l.ownerId ?? ""}
                          onChange={(e) => assignOne(l, e.target.value)}
                          aria-label={`Owner of ${displayName(l)}`}
                          className="!w-36 !border-transparent !bg-transparent !px-1.5 !py-1 text-xs text-ink-soft hover:!border-line"
                        >
                          <option value="">Unassigned</option>
                          {l.ownerId && !assignees!.members.some((m) => m.userId === l.ownerId) && (
                            <option value={l.ownerId}>{l.ownerName ?? "Someone else"}</option>
                          )}
                          {assignees!.members.map((m) => (
                            <option key={m.userId} value={m.userId}>{m.isSelf ? `${m.name} (me)` : m.name}</option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-ink-soft">{l.ownerName ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{addedBy(l)}</td>
                    <td suppressHydrationWarning className="px-4 py-3 font-mono text-xs text-ink-soft">{ago(l.lastActivityAt)}</td>
                    {/* The column the whole product hangs off — loud on purpose. */}
                    <td className="px-4 py-3">
                      {l.nextAction ? (
                        <Link
                          href={`/dashboard/leads/${l.id}`}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
                            l.nextAction.urgent
                              ? "bg-danger-soft text-danger-strong hover:bg-danger-soft/70"
                              : "bg-accent-soft text-accent-strong hover:bg-accent-soft/70",
                          )}
                        >
                          {l.nextAction.urgent ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <CircleDot className="h-3 w-3 shrink-0" />}
                          {l.nextAction.label}
                          <ArrowRight className="h-3 w-3 shrink-0" />
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-faint">Waiting</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => del(l.id)} className="text-ink-soft transition-colors hover:text-danger" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between text-sm text-ink-soft">
            <span className="font-mono text-xs">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={isLoading || page <= 1} className="rounded-lg border border-line px-3 py-1.5 transition hover:bg-tint disabled:opacity-40">Prev</button>
              <span className="font-mono text-xs">Page {page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={isLoading || page >= totalPages} className="rounded-lg border border-line px-3 py-1.5 transition hover:bg-tint disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        leadIds={selectedIds()}
        onDone={(text) => { setMsg({ kind: "success", text }); setSelected(new Set()); setInviteOpen(false); }}
      />

      {/* ---- Add lead ---- */}
      <AddLeadDialog
        open={addOpen}
        onClose={() => { setAddOpen(false); setImportResult(null); }}
        form={form}
        setForm={setForm}
        busy={busy}
        onSubmit={addLead}
        onImport={() => fileRef.current?.click()}
        importResult={importResult}
        assignees={assignees}
        ownerId={newOwnerId}
        setOwnerId={setNewOwnerId}
      />

      {/* ---- Groups ---- */}
      {groupsOpen && (
        <GroupsDialog
          segments={segments ?? []}
          selectedIds={Array.from(selected)}
          onClose={() => setGroupsOpen(false)}
          onChanged={mutateSegments}
          onManage={(s) => { setGroupsOpen(false); setManagingGroup(s); }}
        />
      )}

      {managingGroup && (
        <GroupMembersModal
          segment={managingGroup}
          selectedLeadIds={Array.from(selected)}
          onClose={() => setManagingGroup(null)}
          onSaved={() => { mutateSegments(); setManagingGroup(null); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Add lead — three ways in, one short form                            */
/* ------------------------------------------------------------------ */

type InvitePerson = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  linkedinUrl: string | null;
  status: "will_queue" | "no_profile" | "already_queued" | "opted_out";
};

type InvitePreview = {
  selected: number;
  withProfile: number;
  noProfile: number;
  alreadyQueued: number;
  optedOut: number;
  outOfScope: number;
  autoSend: boolean;
  dailyCap: number;
  remainingToday: number;
  minDelaySec: number;
  maxDelaySec: number;
  people: InvitePerson[];
  peopleTruncated: boolean;
};

const PERSON_NOTE: Record<InvitePerson["status"], string | null> = {
  will_queue: null,
  no_profile: "no LinkedIn profile",
  already_queued: "already waiting",
  opted_out: "opted out",
};

/**
 * Queue connection requests for the selected contacts.
 *
 * The dialog asks the server what would happen before it happens. That ordering
 * is the whole design: most leads in a CRM arrive from CSV or email and have no
 * LinkedIn profile at all, so "queued 0" reported afterwards reads as a broken
 * feature. Told beforehand — "19 of your 24 have a profile" — it reads as a fact
 * about the data, which is what it is.
 */
function InviteDialog({
  open,
  onClose,
  leadIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  onDone: (msg: string) => void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !leadIds.length) return;
    setPreview(null);
    setError(null);
    api<InvitePreview>("/api/linkedin/invite", { body: { leadIds, preview: true } })
      .then(setPreview)
      .catch((e) => setError((e as Error).message));
  }, [open, leadIds]);

  const noteLen = worstCaseNoteLength(note);
  const overLimit = noteLen > INVITE_NOTE_MAX;
  // The cap is a moving target — some of today's allowance may already be spent.
  const willSendToday = preview ? Math.min(preview.withProfile - preview.alreadyQueued, preview.remainingToday) : 0;
  const actionable = preview ? preview.withProfile - preview.alreadyQueued : 0;
  const perInvite = note.trim() ? CREDIT_COSTS.li_invite_note : CREDIT_COSTS.li_invite;

  async function queue() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ queued: number; noProfile: number; alreadyQueued: number }>(
        "/api/linkedin/invite",
        { body: { leadIds, note: note.trim() || undefined, type: "invite" } },
      );
      const bits = [`Queued ${res.queued} connection request${res.queued === 1 ? "" : "s"}`];
      if (res.alreadyQueued) bits.push(`${res.alreadyQueued} already waiting`);
      if (res.noProfile) bits.push(`${res.noProfile} without a LinkedIn profile`);
      onDone(bits.join(" · ") + ".");
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Send connection requests">
      {error && <Banner kind="error">{error}</Banner>}

      {!preview ? (
        <div className="h-24 animate-pulse rounded-xl bg-tint" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-tint/40 p-3.5 text-sm">
            <p className="font-medium">
              {preview.withProfile} of {preview.selected} selected {preview.withProfile === 1 ? "has" : "have"} a
              LinkedIn profile
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
              {preview.noProfile > 0 && (
                <li>{preview.noProfile} will be skipped — no profile URL on the contact.</li>
              )}
              {preview.alreadyQueued > 0 && (
                <li>{preview.alreadyQueued} already have a request waiting, so they will not be queued twice.</li>
              )}
              {preview.optedOut > 0 && <li>{preview.optedOut} opted out and will never be contacted.</li>}
              {preview.outOfScope > 0 && <li>{preview.outOfScope} belong to someone else on your team.</li>}
            </ul>
          </div>

          {/* The people themselves. A count cannot tell you whether the right
              contacts were picked, selection persists across pages so the rows
              are not all on screen, and an invitation cannot be recalled once
              it has gone. */}
          {preview.people.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
              <ul className="divide-y divide-line">
                {preview.people.map((p) => {
                  const note = PERSON_NOTE[p.status];
                  const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.linkedinUrl || "Unnamed contact";
                  return (
                    <li
                      key={p.id}
                      className={`flex items-baseline gap-2 px-3 py-2 text-sm ${note ? "opacity-55" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{name}</span>
                        {(p.title || p.company) && (
                          <span className="text-ink-soft"> · {[p.title, p.company].filter(Boolean).join(" · ")}</span>
                        )}
                      </span>
                      {note && <span className="shrink-0 text-xs text-ink-faint">{note}</span>}
                    </li>
                  );
                })}
              </ul>
              {preview.peopleTruncated && (
                <p className="border-t border-line px-3 py-2 text-xs text-ink-faint">
                  Showing the first {preview.people.length}. The rest are queued the same way.
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Note (optional)</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hi {{firstName}}, saw your work at {{company}} —"
            />
            <p className={`mt-1 text-xs ${overLimit ? "text-danger" : noteLen > 250 ? "text-warning" : "text-ink-faint"}`}>
              About {noteLen} of {INVITE_NOTE_MAX} characters once personalised
              {overLimit ? " — LinkedIn will refuse this. Shorten it." : ""}
            </p>
          </div>

          <div className="rounded-xl bg-accent-soft/60 px-3.5 py-2.5 text-sm">
            <span className="font-mono font-semibold text-accent-strong">
              {actionable * perInvite} credit{actionable * perInvite === 1 ? "" : "s"}
            </span>{" "}
            <span className="text-ink-soft">
              — {perInvite} each{note.trim() ? " (with a note)" : ""} × {actionable}. Taken only as each one actually sends;
              never charged for one that fails or is skipped.
            </span>
          </div>

          <div className="rounded-xl border border-line p-3.5 text-xs text-ink-soft">
            {actionable > preview.remainingToday ? (
              <p>
                <b className="text-ink">{willSendToday} today</b>, the remaining {actionable - willSendToday} tomorrow —
                your cap is {preview.dailyCap} a day and {preview.remainingToday} {preview.remainingToday === 1 ? "is" : "are"} left.
              </p>
            ) : (
              <p>
                All <b className="text-ink">{actionable}</b> fit inside today&apos;s remaining {preview.remainingToday}.
              </p>
            )}
            <p className="mt-1.5">
              {preview.autoSend ? (
                <>
                  Sending is <b className="text-ink">automatic</b> — one every {preview.minDelaySec}–
                  {preview.maxDelaySec} seconds, from the desktop app on your computer. They go out when it is
                  running.
                </>
              ) : (
                <>
                  Automatic sending is <b className="text-ink">off</b>, so nothing will go out and the desktop app
                  will refuse to start. <Link href="/dashboard/linkedin" className="underline">Turn it on</Link>.
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={queue} disabled={busy || overLimit || actionable === 0} className="btn btn-primary !py-2 !text-sm">
              {busy ? "Queueing…" : actionable === 0 ? "Nothing to queue" : `Queue ${actionable}`}
            </button>
            <button onClick={onClose} className="btn btn-ghost !py-2 !text-sm">Cancel</button>
            <Link href="/dashboard/campaigns" className="ml-auto text-xs text-ink-soft underline">
              Following up afterwards? Build a sequence
            </Link>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function AddLeadDialog({
  open, onClose, form, setForm, busy, onSubmit, onImport, importResult, assignees, ownerId, setOwnerId,
}: {
  open: boolean;
  onClose: () => void;
  form: { firstName: string; email: string; company: string; tags: string; linkedinUrl: string };
  setForm: (f: { firstName: string; email: string; company: string; tags: string; linkedinUrl: string }) => void;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onImport: () => void;
  importResult: ImportResult | null;
  assignees?: Assignees;
  ownerId: string;
  setOwnerId: (id: string) => void;
}) {
  const [tab, setTab] = useState<"manual" | "csv">("manual");
  if (!open) return null;

  const tabClass = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-center text-xs font-semibold transition ${
      active ? "border-ink bg-tint" : "border-line hover:bg-tint"
    }`;

  /** Generated from SAMPLE_CSV beside IMPORT_COLUMNS, so the two change together. */
  function downloadSample() {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "followthroo-leads-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onClose={onClose} title="Add Lead" size="md">
      {/* "Find leads" — a paste-a-LinkedIn-link importer — was the third tab
          until 2026-09-10, removed at the client's request. LinkedIn contacts
          come in through the extension, or here by CSV. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <button onClick={() => setTab("manual")} className={tabClass(tab === "manual")}>
          <Plus className="mx-auto mb-1 h-3.5 w-3.5" /> Add manually
        </button>
        <button onClick={() => setTab("csv")} className={tabClass(tab === "csv")}>
          <Upload className="mx-auto mb-1 h-3.5 w-3.5" /> Import CSV or Excel
        </button>
      </div>

      {tab === "csv" && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-ink-soft">
            One row per person, under a header row. Each row needs an <b className="text-ink">email</b> or a{" "}
            <b className="text-ink">LinkedIn URL</b> — everything else is optional.
          </p>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-tint font-mono uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Column</th>
                  <th className="px-3 py-2">Also accepted</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {IMPORT_COLUMNS.map((c) => (
                  <tr key={c.column}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-ink">{c.column}</td>
                    <td className="px-3 py-2 text-ink-soft">{c.aliases ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-soft">{c.note ?? ""}</td>
                  </tr>
                ))}
                <tr>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-ink">any other</td>
                  <td className="px-3 py-2 text-ink-soft">—</td>
                  <td className="px-3 py-2 text-ink-soft">
                    Kept on the lead, and usable in templates as {"{{Column name}}"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink-soft">
            Header names ignore capitals and spaces, so “First Name” works. Importing LinkedIn contacts in bulk? A
            LinkedIn URL column on its own is enough.
          </p>

          {importResult && (
            <Banner kind={importResult.imported > 0 ? (importResult.skipped ? "info" : "success") : "error"}>
              <div className="space-y-1">
                <p>
                  Imported {importResult.imported}
                  {importResult.skipped ? `, skipped ${importResult.skipped}` : ""}.
                </p>
                {!!importResult.errors?.length && (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs">
                    {importResult.errors.slice(0, 3).map((e, i) => (
                      <li key={i} className="break-all">{e}</li>
                    ))}
                    {importResult.errors.length > 3 && <li>…and {importResult.errors.length - 3} more</li>}
                  </ul>
                )}
              </div>
            </Banner>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={downloadSample} className="btn btn-ghost !py-2 !text-sm">
              <Download className="h-4 w-4" /> Sample CSV
            </button>
            <button type="button" onClick={onImport} disabled={busy} className="btn btn-primary !py-2 !text-sm disabled:opacity-50">
              <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Choose CSV or Excel"}
            </button>
          </div>
        </div>
      )}

      {tab === "manual" && (
      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <div>
          <Label>First name</Label>
          <Input autoFocus value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Jane" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@acme.com" />
          </div>
          <div>
            <Label>Company</Label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme" />
          </div>
        </div>
        <div>
          <Label>LinkedIn URL</Label>
          <Input type="url" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/jane" />
        </div>
        <div>
          <Label>Tags (comma-separated)</Label>
          <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vip, warm" />
        </div>
        {/* Only when there is a real choice; otherwise the source's rule applies, which for a manual add is you. */}
        {(assignees?.members.length ?? 0) > 1 && (
          <div>
            <Label>Owner</Label>
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Automatic (usually you)</option>
              {assignees!.members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.isSelf ? `${m.name} (you)` : m.name}</option>
              ))}
            </Select>
          </div>
        )}
        <p className="text-xs text-ink-soft">An email or a LinkedIn URL is required — everything else can wait.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-ghost !py-2 !text-sm">Cancel</button>
          <button disabled={busy} className="btn btn-primary !py-2 !text-sm disabled:opacity-50">
            <Plus className="h-4 w-4" /> Add Lead
          </button>
        </div>
      </form>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Groups — same static-list semantics, off the main surface           */
/* ------------------------------------------------------------------ */

function GroupsDialog({
  segments, selectedIds, onClose, onChanged, onManage,
}: {
  segments: Segment[];
  selectedIds: string[];
  onClose: () => void;
  onChanged: () => void;
  onManage: (s: Segment) => void;
}) {
  const [newGroup, setNewGroup] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const confirm = useConfirm();

  async function create() {
    if (!newGroup.trim()) return;
    await api("/api/segments", { body: { name: newGroup.trim(), kind: "static", leadIds: selectedIds } });
    setNewGroup("");
    onChanged();
  }
  async function rename(id: string, name: string) {
    if (!name.trim()) return;
    await api("/api/segments", { method: "PATCH", body: { id, name: name.trim() } });
    setEditing(null);
    onChanged();
  }
  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete this group?",
      body: "The leads in it are kept — only the group is removed.",
      confirmLabel: "Delete group",
      tone: "danger",
    });
    if (!ok) return;
    await api(`/api/segments?id=${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <Dialog open onClose={onClose} title="Groups" size="md">
      <p className="text-xs text-ink-soft">Static lists — the same thing as tags. Target one when you launch a campaign.</p>

      <div className="mt-4 space-y-2">
        {segments.length === 0 && <p className="text-sm text-ink-soft">No groups yet.</p>}
        {segments.map((s) => (
          <div key={s.id} className="rounded-xl border border-line text-sm">
            {editing?.id === s.id ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <Input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(s.id, editing.name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="!py-1 !text-sm"
                />
                <button onClick={() => rename(s.id, editing.name)} className="shrink-0 text-success hover:text-success-strong" title="Save">
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => setEditing(null)} className="shrink-0 text-ink-soft hover:text-ink" title="Cancel">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate font-medium">{s.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full bg-tint px-2 py-0.5 font-mono text-xs">{s.count}</span>
                  <button onClick={() => onManage(s)} className="text-ink-soft hover:text-accent" aria-label="Edit members" title="Edit members">
                    <Users className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditing({ id: s.id, name: s.name })} className="text-ink-soft hover:text-ink" aria-label="Rename group">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(s.id)} className="text-ink-soft hover:text-danger" aria-label="Delete group">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name…" onKeyDown={(e) => e.key === "Enter" && create()} />
        <button onClick={create} disabled={!newGroup.trim()} className="btn btn-primary w-full justify-center !py-2 !text-sm disabled:opacity-40">
          <FolderPlus className="h-4 w-4" />
          {selectedIds.length > 0 ? `Create group with ${selectedIds.length} lead(s)` : "Create group"}
        </button>
        {selectedIds.length === 0 && (
          <p className="text-center text-xs text-ink-soft">Select leads in the table first to start the group with them.</p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// GroupMembersModal — view / remove / add leads inside a group
// ---------------------------------------------------------------------------

type GroupMembersModalProps = {
  segment: { id: string; name: string; leadIds: string[] };
  selectedLeadIds: string[];   // leads selected in the main table to quick-add
  onClose: () => void;
  onSaved: () => void;
};

function GroupMembersModal({ segment, selectedLeadIds, onClose, onSaved }: GroupMembersModalProps) {
  // Local copy of leadIds so changes are staged before saving
  const [pendingIds, setPendingIds] = useState<string[]>(segment.leadIds);
  const [saving, setSaving] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  // Fetch the actual lead objects for the current pendingIds
  const idsParam = pendingIds.join(",");
  const { data, isLoading } = useSWR<{ items: Lead[] }>(
    pendingIds.length ? `/api/leads?ids=${idsParam}&pageSize=500` : null
  );
  const members = data?.items ?? [];

  const filtered = memberSearch.trim()
    ? members.filter(
        (l) =>
          `${l.firstName ?? ""} ${l.lastName ?? ""} ${l.email} ${l.company ?? ""}`
            .toLowerCase()
            .includes(memberSearch.toLowerCase())
      )
    : members;

  // Leads selected in the parent table that aren't already in this group
  const addable = selectedLeadIds.filter((id) => !pendingIds.includes(id));

  function removeLead(id: string) {
    setPendingIds((prev) => prev.filter((x) => x !== id));
  }

  function addSelected() {
    setPendingIds((prev) => Array.from(new Set([...prev, ...addable])));
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/segments", { method: "PATCH", body: { id: segment.id, leadIds: pendingIds } });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify([...pendingIds].sort()) !== JSON.stringify([...segment.leadIds].sort());

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit members — ${segment.name}`}
      size="md"
      chrome={false}
      className="max-h-[85vh]"
    >
      <div className="flex max-h-[85vh] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="font-display text-base font-bold">Edit members — {segment.name}</h3>
            <p className="mt-0.5 text-xs text-ink-soft">{pendingIds.length} lead(s) in group</p>
          </div>
          <button onClick={onClose} className="text-ink-soft hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        {/* Quick-add bar */}
        {addable.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft px-5 py-3">
            <span className="text-xs text-accent-strong">
              <strong>{addable.length}</strong> selected lead(s) not in this group
            </span>
            <button
              onClick={addSelected}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-solid transition hover:bg-accent-strong"
            >
              <Plus className="h-3.5 w-3.5" /> Add to group
            </button>
          </div>
        )}

        {/* Search */}
        <div className="border-b border-line px-5 py-3">
          <input
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Search within group…"
            className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </div>

        {/* Members list */}
        <div className="flex-1 space-y-1.5 overflow-y-auto px-5 py-3">
          {isLoading && <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>}
          {!isLoading && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-soft">
              {pendingIds.length === 0 ? "Group is empty." : "No matches."}
            </p>
          )}
          {filtered.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{displayName(l)}</p>
                <p className="truncate text-xs text-ink-soft">{l.email}{l.company ? ` · ${l.company}` : ""}</p>
              </div>
              <button
                onClick={() => removeLead(l.id)}
                className="shrink-0 rounded-full p-1 text-ink-soft transition hover:bg-danger-soft hover:text-danger"
                title="Remove from group"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold transition hover:bg-tint">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-ink-invert transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Saving…" : `Save changes${dirty ? ` (${pendingIds.length} leads)` : ""}`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
