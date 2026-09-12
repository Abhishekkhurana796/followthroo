"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, Linkedin, Instagram, Bot, Clock, ImageIcon, ExternalLink, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { Badge, Banner, DashHeader, EmptyState, Panel, Skeleton, useConfirm, useToast } from "@/components/ui";

type Post = {
  id: string;
  status: string;
  body: string;
  mediaUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrn: string | null;
  error: string | null;
  autopilotId: string | null;
  createdAt: string;
};
type Autopilot = { id: string; name: string; enabled: boolean; mode: string; nextRunAt: string | null; query: string };

const TABS = [
  { key: "needs_review", label: "Needs review" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Drafts" },
  { key: "failed", label: "Failed" },
] as const;

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  needs_review: "warning",
  scheduled: "accent",
  publishing: "accent",
  published: "success",
  failed: "danger",
  skipped: "neutral",
};

function when(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Posts home: LinkedIn now, Instagram "coming soon" — a platform switch over
 * one screen rather than two, since Instagram has nothing behind it yet but
 * the same shape of nav will when it does.
 */
export default function PostsClient() {
  const [platform, setPlatform] = useState<"linkedin" | "instagram">("linkedin");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("needs_review");
  const { data: posts, mutate, isLoading } = useSWR<Post[]>(
    platform === "linkedin" ? `/api/posts?platform=linkedin&status=${tab}` : null,
  );
  const { data: autopilots } = useSWR<Autopilot[]>(platform === "linkedin" ? "/api/autopilots" : null);
  const confirm = useConfirm();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    try {
      await api(`/api/posts/${id}`, { method: "PATCH", body: { action: "approve" } });
      toast("Scheduled.", "success");
      mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function publishNow(id: string) {
    const ok = await confirm({ title: "Publish now?", body: "This posts to your LinkedIn feed immediately.", confirmLabel: "Publish" });
    if (!ok) return;
    try {
      await api(`/api/posts/${id}`, { method: "PATCH", body: { action: "publish_now" } });
      toast("Publishing…", "success");
      mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(id: string) {
    const ok = await confirm({ title: "Delete this draft?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    await api(`/api/posts/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <>
      <DashHeader
        title="Posts"
        subtitle="Write and schedule LinkedIn posts, or let an autopilot find topics and write them for you."
        action={
          platform === "linkedin" ? (
            <div className="flex items-center gap-2">
              <Link href="/dashboard/posts/autopilots/new" className="btn btn-ghost !py-2 !text-sm">
                <Bot className="h-4 w-4" /> New autopilot
              </Link>
              <Link href="/dashboard/posts/new" className="btn btn-primary !py-2 !text-sm">
                <Plus className="h-4 w-4" /> New post
              </Link>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-5 p-8">
        {error && <Banner kind="error">{error}</Banner>}

        <div className="flex rounded-xl border border-line p-1" role="tablist" aria-label="Platform">
          <button
            role="tab"
            aria-selected={platform === "linkedin"}
            onClick={() => setPlatform("linkedin")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${platform === "linkedin" ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint"}`}
          >
            <Linkedin className="h-3.5 w-3.5" /> LinkedIn
          </button>
          <button
            role="tab"
            aria-selected={platform === "instagram"}
            onClick={() => setPlatform("instagram")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${platform === "instagram" ? "bg-ink text-ink-invert" : "text-ink-soft hover:bg-tint"}`}
          >
            <Instagram className="h-3.5 w-3.5" /> Instagram
            <Badge tone="neutral">Soon</Badge>
          </button>
        </div>

        {platform === "instagram" ? (
          <InstagramComingSoon />
        ) : (
          <>
            {autopilots && autopilots.length > 0 && (
              <Panel>
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Autopilots</h2>
                <ul className="mt-3 divide-y divide-line">
                  {autopilots.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/dashboard/posts/autopilots/${a.id}`} className="text-sm font-semibold hover:underline">
                          {a.name}
                        </Link>
                        <div className="truncate text-xs text-ink-soft">
                          &ldquo;{a.query}&rdquo; · {a.mode === "auto" ? "publishes automatically" : "drafts for review"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {a.enabled ? (
                          <Badge tone="success">On · next {when(a.nextRunAt) ?? "—"}</Badge>
                        ) : (
                          <Badge tone="neutral">Paused</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Post status">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${tab === t.key ? "bg-accent-soft text-accent-strong" : "border border-line text-ink-soft hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-32 rounded-2xl" />
                <Skeleton className="h-32 rounded-2xl" />
              </div>
            ) : !posts?.length ? (
              <EmptyState
                icon={Plus}
                title={`Nothing ${TABS.find((t) => t.key === tab)?.label.toLowerCase()}`}
                body="Write one by hand, or set up an autopilot to find topics and draft them for you."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {posts.map((p) => (
                  <li key={p.id}>
                    <Panel className="flex h-full flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status.replace("_", " ")}</Badge>
                        {p.autopilotId && <Bot className="h-3.5 w-3.5 text-ink-faint" aria-label="Written by an autopilot" />}
                      </div>
                      <p className="mt-2 line-clamp-4 flex-1 whitespace-pre-wrap text-sm text-ink">{p.body}</p>
                      {p.mediaUrl && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-ink-soft">
                          <ImageIcon className="h-3.5 w-3.5" /> Image attached
                        </div>
                      )}
                      {p.error && <p className="mt-2 text-xs text-danger">{p.error}</p>}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-soft">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {p.status === "published" ? when(p.publishedAt) : p.scheduledAt ? when(p.scheduledAt) : "Not scheduled"}
                        </span>
                        <div className="flex items-center gap-2">
                          {p.status === "published" && p.externalUrn && (
                            <a
                              href={`https://www.linkedin.com/feed/update/${encodeURIComponent(p.externalUrn)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-accent-strong hover:underline"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {p.status === "needs_review" && (
                            <button onClick={() => approve(p.id)} className="font-semibold text-accent-strong hover:underline">
                              Approve
                            </button>
                          )}
                          {(p.status === "draft" || p.status === "needs_review") && (
                            <button onClick={() => publishNow(p.id)} className="font-semibold text-ink-soft hover:text-ink">
                              Publish now
                            </button>
                          )}
                          {p.status === "draft" && (
                            <Link href={`/dashboard/posts/${p.id}`} className="font-semibold text-ink-soft hover:text-ink">
                              Edit
                            </Link>
                          )}
                          {p.status !== "published" && (
                            <button onClick={() => remove(p.id)} className="text-ink-faint hover:text-danger" aria-label="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </Panel>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

function InstagramComingSoon() {
  const { data, mutate } = useSWR<{ registered: boolean }>("/api/product-interest?feature=instagram_posts");
  const [busy, setBusy] = useState(false);
  async function notifyMe() {
    setBusy(true);
    await api("/api/product-interest", { body: { feature: "instagram_posts" } });
    await mutate();
    setBusy(false);
  }
  return (
    <Panel className="flex flex-col items-center gap-3 py-14 text-center">
      <Instagram className="h-10 w-10 text-ink-faint" />
      <h2 className="font-display text-lg font-bold">Instagram posts are coming soon</h2>
      <p className="max-w-sm text-sm text-ink-soft">
        The same writing and scheduling you get for LinkedIn, for your Instagram feed. We&apos;ll email you the moment it&apos;s ready.
      </p>
      {data?.registered ? (
        <Badge tone="success">You&apos;re on the list</Badge>
      ) : (
        <button onClick={notifyMe} disabled={busy} className="btn btn-primary !py-2 !text-sm">
          Notify me
        </button>
      )}
    </Panel>
  );
}
