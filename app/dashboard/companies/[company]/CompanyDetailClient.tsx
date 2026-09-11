"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Building2, ArrowLeft, Rocket, FolderPlus, Linkedin as LinkedinIcon, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { Banner, DashHeader, Panel, Select, Skeleton, useConfirm, usePrompt } from "@/components/ui";

type Lead = { id: string; firstName: string | null; lastName: string | null; email: string | null; linkedinUrl: string | null; stage: string };
type LeadsResponse = { items: Lead[]; total: number };
type Campaign = { id: string; name: string };
type Segment = { id: string; name: string };

export default function CompanyDetailClient({ company }: { company: string }) {
  const key = `/api/leads?company=${encodeURIComponent(company)}&pageSize=500`;
  const { data, isLoading } = useSWR<LeadsResponse>(key);
  const { data: campaigns = [] } = useSWR<Campaign[]>("/api/campaigns");
  const { data: segments = [] } = useSWR<Segment[]>("/api/segments");
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  const leads = data?.items ?? [];
  const ids = leads.map((l) => l.id);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const router = useRouter();

  async function renameCompany() {
    const name = await prompt({
      title: "Rename company",
      body: `Every lead currently at ${company} moves to the new name.`,
      label: "Company name",
      placeholder: company,
      confirmLabel: "Rename",
    });
    if (!name || !name.trim() || name.trim() === company) return;
    try {
      await api(`/api/companies/${encodeURIComponent(company)}`, { method: "PATCH", body: { name: name.trim() } });
      router.replace(`/dashboard/companies/${encodeURIComponent(name.trim())}`);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function deleteCompany() {
    const okConfirm = await confirm({
      title: `Delete ${company}?`,
      body: `This removes the company grouping only — ${leads.length} lead${leads.length === 1 ? "" : "s"} stay in Followthroo, just without a company on file.`,
      confirmLabel: "Delete company",
      tone: "danger",
    });
    if (!okConfirm) return;
    try {
      await api(`/api/companies/${encodeURIComponent(company)}`, { method: "DELETE" });
      router.replace("/dashboard/companies");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function enrollAll(campaignId: string) {
    if (!campaignId || ids.length === 0) return;
    const ok = await confirm({
      title: `Enroll ${ids.length} lead${ids.length === 1 ? "" : "s"} at ${company}?`,
      body: "Everyone at this company starts receiving the campaign's sequence.",
      confirmLabel: "Enroll",
    });
    if (!ok) return;
    try {
      const res = await api<{ enrolled: number; skipped: number }>(`/api/campaigns/${campaignId}/enroll`, { body: { leadIds: ids } });
      setMsg({ kind: "success", text: `Enrolled ${res.enrolled}, skipped ${res.skipped} already in campaign.` });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }
  async function addAllToGroup(segmentId: string) {
    if (!segmentId || ids.length === 0) return;
    await api("/api/leads/bulk", { body: { leadIds: ids, segmentId } });
    setMsg({ kind: "success", text: `Added ${ids.length} lead(s) to the group.` });
  }

  return (
    <>
      <DashHeader
        title={company}
        subtitle={`${leads.length} lead${leads.length === 1 ? "" : "s"} at this company`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={renameCompany} className="btn btn-ghost !py-2 !text-sm">
              <Pencil className="h-4 w-4" /> Rename
            </button>
            <button onClick={deleteCompany} className="btn btn-ghost !py-2 !text-sm !text-danger">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
            <Link href="/dashboard/companies" className="btn btn-ghost !py-2 !text-sm">
              <ArrowLeft className="h-4 w-4" /> All companies
            </Link>
          </div>
        }
      />

      <div className="space-y-4 p-8">
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

        {/* Actions */}
        {leads.length > 0 && (
          <Panel className="!p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4" /> Bulk actions</span>
              <Select defaultValue="" onChange={(e) => { enrollAll(e.target.value); e.target.value = ""; }} className="!w-56 !py-2 text-sm">
                <option value="">Enroll all in campaign…</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select defaultValue="" onChange={(e) => { addAllToGroup(e.target.value); e.target.value = ""; }} className="!w-56 !py-2 text-sm">
                <option value="">Add all to group…</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          </Panel>
        )}

        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-tint font-mono text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">LinkedIn</th>
                <th className="px-4 py-3">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <>{Array.from({ length: 6 }).map((_, i) => (<tr key={i}>{Array.from({ length: 4 }).map((__, c) => (<td key={c} className="px-4 py-3"><Skeleton className="h-3.5 w-24" /></td>))}</tr>))}</>
              ) : leads.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-soft">No leads at this company.</td></tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/dashboard/leads/${l.id}`} className="hover:text-accent hover:underline">
                        {[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed lead"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{l.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      {l.linkedinUrl ? (
                        <a href={l.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                          <LinkedinIcon className="h-3.5 w-3.5" /> Profile
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-tint px-2 py-0.5 font-mono text-xs">{l.stage}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
