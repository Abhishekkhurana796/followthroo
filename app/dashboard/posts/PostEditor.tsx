"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ImagePlus, Sparkles, Search, X, Loader2, ExternalLink } from "lucide-react";
import { api } from "@/lib/client";
import { Banner, DashHeader, Input, Label, Panel, Select, Textarea, useConfirm } from "@/components/ui";
import { POST_MODELS } from "@/lib/posts/models";

type Source = { title: string; url: string };
type Topic = { topic: string; why: string; sources: Source[] };
type Post = { id: string; body: string; mediaUrl: string | null; mediaAlt: string | null; status: string; scheduledAt: string | null };

const MAX_CHARS = 3000;

/** Shared by /dashboard/posts/new and /dashboard/posts/[id]. */
export default function PostEditor({ postId }: { postId?: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { data: existing } = useSWR<Post>(postId ? `/api/posts/${postId}` : null);

  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI panel
  const [aiOpen, setAiOpen] = useState(!postId);
  const [query, setQuery] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState(POST_MODELS[0].id);
  const [researching, setResearching] = useState(false);
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (existing) {
      setBody(existing.body);
      setMediaUrl(existing.mediaUrl);
      setScheduledAt(existing.scheduledAt ? existing.scheduledAt.slice(0, 16) : "");
    }
  }, [existing]);

  const over = body.length > MAX_CHARS;

  async function research() {
    if (!query.trim()) return;
    setResearching(true);
    setError(null);
    try {
      const res = await api<{ topics: Topic[] }>("/api/posts/research", {
        body: { query, hashtags: hashtags.split(",").map((h) => h.trim()).filter(Boolean) },
      });
      setTopics(res.topics);
      if (!res.topics.length) setError("Nothing found for that query — try broadening it, or write without a topic.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResearching(false);
    }
  }

  async function writeFrom(topic: Topic | null) {
    setWriting(true);
    setError(null);
    try {
      const post = await api<Post>("/api/posts", { body: { write: { model, brief: brief || undefined, topic: topic ?? undefined } } });
      setBody(post.body);
      setAiOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWriting(false);
    }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/posts/upload-image", { method: "POST", body: form, credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Upload failed");
      setMediaUrl(json.data.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save(action?: "approve" | "publish_now") {
    if (!body.trim() || over) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { body, mediaUrl };
      if (action) payload.action = action;
      else if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();

      if (postId) {
        await api(`/api/posts/${postId}`, { method: "PATCH", body: payload });
      } else {
        const created = await api<Post>("/api/posts", { body: { body, mediaUrl } });
        if (action || scheduledAt) {
          await api(`/api/posts/${created.id}`, { method: "PATCH", body: action ? { action } : { scheduledAt: payload.scheduledAt } });
        }
      }
      router.push("/dashboard/posts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function publishNow() {
    const ok = await confirm({ title: "Publish now?", body: "This posts to your LinkedIn feed immediately.", confirmLabel: "Publish" });
    if (ok) save("publish_now");
  }

  return (
    <>
      <DashHeader
        title={postId ? "Edit post" : "New post"}
        breadcrumb={
          <div className="mb-1 text-xs text-ink-soft">
            <Link href="/dashboard/posts" className="hover:text-ink">
              Posts
            </Link>{" "}
            / {postId ? "Edit" : "New"}
          </div>
        }
      />
      <div className="grid max-w-5xl gap-6 p-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {error && <Banner kind="error">{error}</Banner>}

          <Panel>
            <div className="flex items-center justify-between">
              <Label>Post</Label>
              <button onClick={() => setAiOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-accent-strong hover:underline">
                <Sparkles className="h-3.5 w-3.5" /> {aiOpen ? "Hide AI panel" : "Write with AI"}
              </button>
            </div>
            <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your post…" className="mt-2" />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-ink-soft">LinkedIn posts are plain text — no markdown formatting is rendered.</span>
              <span className={over ? "font-semibold text-danger" : "text-ink-soft"}>{body.length} / {MAX_CHARS}</span>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <div className="relative">
                  <img src={mediaUrl} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" />
                  <button onClick={() => setMediaUrl(null)} className="absolute -right-2 -top-2 rounded-full bg-ink p-1 text-ink-invert">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-soft hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Add an image
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
              />
            </div>
          </Panel>

          <Panel>
            <Label>Schedule (optional)</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            <p className="mt-1 text-xs text-ink-soft">Leave blank to save as a draft — publish later from the Posts list.</p>
          </Panel>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => save()} disabled={saving || !body.trim() || over} className="btn btn-primary disabled:opacity-50">
              {scheduledAt ? "Save & schedule" : "Save as draft"}
            </button>
            <button onClick={publishNow} disabled={saving || !body.trim() || over} className="btn btn-ghost disabled:opacity-50">
              Publish now
            </button>
          </div>
        </div>

        {aiOpen && (
          <Panel className="h-fit space-y-4">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Write with AI</h2>
            {/* Repeated here, not just at the top of the left column — this panel is
                where the user is looking when a research or write call fails, and an
                error that only appears elsewhere reads as "nothing happened". */}
            {error && <Banner kind="error">{error}</Banner>}
            <div>
              <Label>Model</Label>
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {POST_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.tier === "premium" ? "premium" : "standard"})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Brief / tone (optional)</Label>
              <Textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. conversational, first-person, no hard sell" />
            </div>
            <div className="border-t border-line pt-3">
              <Label>Find a trending topic</Label>
              <div className="flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. B2B sales AI" />
                <button onClick={research} disabled={researching || !query.trim()} className="btn btn-ghost shrink-0 !px-3 disabled:opacity-50">
                  {researching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>
              </div>
              <Input className="mt-2" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="hashtags, comma-separated" />
            </div>

            {topics && topics.length > 0 && (
              <ul className="space-y-2">
                {topics.map((t, i) => (
                  <li key={i} className="rounded-xl border border-line p-3">
                    <div className="text-sm font-semibold">{t.topic}</div>
                    <p className="mt-0.5 text-xs text-ink-soft">{t.why}</p>
                    {t.sources.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {t.sources.slice(0, 3).map((s) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-[11px] text-accent-strong hover:underline">
                            {s.title.slice(0, 30)} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))}
                      </div>
                    )}
                    <button onClick={() => writeFrom(t)} disabled={writing} className="btn btn-primary mt-2 !py-1.5 !text-xs disabled:opacity-50">
                      {writing ? "Writing…" : "Write this"}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button onClick={() => writeFrom(null)} disabled={writing} className="w-full text-center text-xs font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
              Or write without a specific topic
            </button>
          </Panel>
        )}
      </div>
    </>
  );
}
