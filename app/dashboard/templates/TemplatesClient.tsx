"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/client";
import { Banner, DashHeader, EmptyState, Input, Label, Panel, Select, Textarea, useConfirm } from "@/components/ui";
import { FileText, Pencil, Copy, Archive, Eye, Send, History, Search, Plus, X, AlertTriangle, Bot } from "lucide-react";
import Link from "next/link";

type Template = { id: string; channel: string; name: string; subject: string | null; body: string; updatedAt?: string };
type Version = { id: string; version: number; subject: string | null; body: string; createdAt: string };
type Campaign = { id: string; name: string; status: string };
type Detail = Template & {
  versions: Version[];
  usedBy: Campaign[];
  spam: { score: number; flags: string[] };
};
type Preview = {
  subject: string | null;
  body: string;
  renderedAgainst: { id: string; name: string; email: string | null };
  unresolved: string[];
  spam: { score: number; flags: string[] };
};

/**
 * What an edit does to campaigns that are already running.
 *
 * This dialog is not a nicety. Message bodies are resolved at send time from the
 * template id, so without a choice here an edit silently rewrites every unsent
 * step of every live sequence — see lib/template-versions.ts.
 */
const APPLY_OPTIONS = [
  {
    value: "future_only",
    label: "Future campaigns only",
    hint: "Campaigns already running keep the wording they were built with.",
  },
  {
    value: "this_campaign",
    label: "This campaign's unsent messages",
    hint: "Pick one running campaign to switch over. Everything else keeps the old wording.",
  },
  {
    value: "new_version",
    label: "Just save a new version",
    hint: "Nothing switches over. Useful for drafting ahead of a change.",
  },
] as const;

const EMPTY_FORM = { channel: "email", name: "", subject: "", body: "" };

export default function TemplatesPage() {
  const { data: templates = [], mutate } = useSWR<Template[]>("/api/templates");
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.subject ?? "").toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q)
    );
  }, [templates, query]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/templates", { body: { ...form, subject: form.subject || undefined } });
      setForm(EMPTY_FORM);
      setMsg({ kind: "success", text: "Template saved." });
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(id: string) {
    try {
      await api(`/api/templates/${id}`, { body: { action: "duplicate" } });
      setMsg({ kind: "success", text: "Duplicated." });
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function archive(t: Template) {
    const yes = await confirm({
      title: `Archive "${t.name}"?`,
      body: "It disappears from this list and from the campaign builder. Messages already sent keep their wording, and running campaigns are unaffected.",
      confirmLabel: "Archive",
      tone: "danger",
    });
    if (!yes) return;
    try {
      await api(`/api/templates/${t.id}`, { method: "DELETE" });
      setMsg({ kind: "success", text: `"${t.name}" archived.` });
      mutate();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <>
      <DashHeader
        title="Templates"
        subtitle="Write once, personalize for everyone with {{variables}}."
        action={
          /* Test emails lost its rail row — it is a harness for checking a model
             change against one lead, not a daily destination. It belongs next to
             the wording it tests. */
          <Link href="/dashboard/agent" className="btn btn-ghost !py-2 !text-sm">
            <Bot className="h-4 w-4" /> Test emails
          </Link>
        }
      />
      <div className="grid gap-6 p-8 lg:grid-cols-[380px_1fr]">
        <Panel className="h-fit">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Plus className="h-4 w-4" /> New template
          </h2>
          <form onSubmit={create} className="mt-4 space-y-3">
            <div>
              <Label>Channel</Label>
              <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="email">Email</option>
                <option value="linkedin">LinkedIn</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="social">Social</option>
              </Select>
            </div>
            <div>
              <Label>Name *</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HR Outreach — First Contact" />
            </div>
            {form.channel === "email" && (
              <div>
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Quick question about your hiring plans" />
              </div>
            )}
            <div>
              <Label>Message *</Label>
              <Textarea
                required
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder={"Hi {{firstName|there}},\n\nI noticed {{company}} is scaling — thought this might help."}
              />
            </div>
            <button disabled={busy} className="btn btn-primary w-full justify-center disabled:opacity-50">Save template</button>
          </form>
          <p className="mt-4 font-mono text-xs text-ink-soft">Use {"{{firstName|there}}"} for a safe fallback.</p>
        </Panel>

        <div className="space-y-4">
          {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

          {templates.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates…"
                className="!pl-9"
              />
            </div>
          )}

          {templates.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No templates yet"
              body="Templates are the reusable copy your campaigns send, with each contact's name and company merged in. Write one on the left to get started."
            />
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-soft">Nothing matches “{query}”.</p>
          ) : (
            filtered.map((t) =>
              editingId === t.id ? (
                <TemplateEditor
                  key={t.id}
                  template={t}
                  onClose={() => setEditingId(null)}
                  onSaved={(text) => {
                    setEditingId(null);
                    setMsg({ kind: "success", text });
                    mutate();
                  }}
                />
              ) : (
                <Panel key={t.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-bold">{t.name}</h3>
                      {t.subject && <div className="mt-1 text-sm font-medium">{t.subject}</div>}
                    </div>
                    <span className="shrink-0 rounded-full bg-tint px-2.5 py-0.5 font-mono text-xs">{t.channel}</span>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-sm text-ink-soft">{t.body}</pre>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    <IconButton icon={Pencil} label="Edit" onClick={() => setEditingId(t.id)} />
                    <IconButton icon={Copy} label="Duplicate" onClick={() => duplicate(t.id)} />
                    <IconButton icon={Archive} label="Archive" onClick={() => archive(t)} />
                  </div>
                </Panel>
              )
            )
          )}
        </div>
      </div>
    </>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  tone = "ghost",
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  tone?: "ghost" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
        tone === "primary" ? "bg-ink text-surface hover:opacity-90" : "bg-tint hover:bg-line"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: Template;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { data: detail } = useSWR<Detail>(`/api/templates/${template.id}`);
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [apply, setApply] = useState<(typeof APPLY_OPTIONS)[number]["value"]>("future_only");
  const [campaignId, setCampaignId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const running = detail?.usedBy ?? [];
  const dirty = name !== template.name || subject !== (template.subject ?? "") || body !== template.body;

  async function act<T>(fn: () => Promise<T>, onOk?: (r: T) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      onOk?.(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(
      () =>
        api<{ campaignsAffected: number; version: number }>(`/api/templates/${template.id}`, {
          method: "PATCH",
          body: { name, subject: subject || null, body, apply, ...(apply === "this_campaign" ? { campaignId } : {}) },
        }),
      (r) =>
        onSaved(
          r.campaignsAffected > 0
            ? `Saved. ${r.campaignsAffected} running campaign${r.campaignsAffected === 1 ? "" : "s"} updated.`
            : "Saved."
        )
    );

  return (
    <Panel className="ring-2 ring-ink/10">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <Pencil className="h-4 w-4" /> Edit template
        </h3>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-soft hover:bg-tint" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="success">{notice}</Banner>}

      <div className="space-y-3">
        <div>
          <Label>Template name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {template.channel === "email" && (
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}
        <div>
          <Label>Message</Label>
          <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        {detail && detail.spam.flags.length > 0 && (
          <div className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning-strong">
            <AlertTriangle className="h-4 w-4 shrink-0 translate-y-0.5" />
            <p>
              Spam-filter risk {detail.spam.score}: {detail.spam.flags.join(", ")}
            </p>
          </div>
        )}

        {/* The choice that keeps an edit from rewriting live sequences. */}
        {dirty && running.length > 0 && (
          <div className="rounded-xl border border-line bg-tint/40 p-3">
            <p className="mb-2 text-xs font-medium">
              {running.length} campaign{running.length === 1 ? " is" : "s are"} running on this template. Apply changes to:
            </p>
            <div className="space-y-1.5">
              {APPLY_OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name={`apply-${template.id}`}
                    checked={apply === o.value}
                    onChange={() => setApply(o.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{o.label}</span>
                    <span className="block text-ink-soft">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {apply === "this_campaign" && (
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="mt-2 text-xs">
                <option value="">Choose a campaign…</option>
                {running.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button
            onClick={save}
            disabled={busy || !dirty || (apply === "this_campaign" && !campaignId)}
            className="btn btn-primary text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          <IconButton
            icon={Eye}
            label="Preview"
            onClick={() => act(() => api<Preview>(`/api/templates/${template.id}`, { body: { action: "preview" } }), setPreview)}
          />
          <IconButton
            icon={Send}
            label="Test send"
            onClick={() =>
              act(
                () => api<{ to: string }>(`/api/templates/${template.id}`, { body: { action: "test_send" } }),
                // The test goes to the signed-in user, never to the contact whose
                // data rendered it — worth saying, so nobody hesitates to click.
                (r) => setNotice(`Test sent to ${r.to}.`)
              )
            }
          />
          <IconButton icon={History} label={showHistory ? "Hide history" : "History"} onClick={() => setShowHistory((v) => !v)} />
        </div>

        {preview && (
          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 text-xs text-ink-soft">
              Rendered against {preview.renderedAgainst.name || preview.renderedAgainst.email}
            </div>
            {preview.subject && <div className="text-sm font-medium">{preview.subject}</div>}
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{preview.body}</pre>
            {preview.unresolved.length > 0 && (
              <p className="mt-2 text-xs text-warning-strong">
                No value on this contact for: {preview.unresolved.join(", ")} — add a fallback like{" "}
                {`{{${preview.unresolved[0]}|there}}`}.
              </p>
            )}
          </div>
        )}

        {showHistory && detail && (
          <div className="rounded-xl border border-line">
            {detail.versions.length === 0 ? (
              <p className="p-3 text-xs text-ink-soft">No earlier versions yet — one is saved the first time you edit.</p>
            ) : (
              <div className="divide-y divide-line">
                {detail.versions.map((v) => (
                  <div key={v.id} className="p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">Version {v.version}</span>
                      <span className="text-ink-soft">{new Date(v.createdAt).toLocaleString()}</span>
                    </div>
                    <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-ink-soft">{v.body}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
