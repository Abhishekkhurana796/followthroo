"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Linkedin, ArrowRight, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/client";
import { Banner, Input, Label, Select } from "@/components/ui";
import { detectScrapeKind, SUPPORTED_HINT } from "@/lib/linkedin/detect";

type Usage = { cap: number; used: number; remaining: number; connected: boolean; resetsAt: string };
type Jobs = { jobs: { id: string; status: string }[]; usage: Usage };

/**
 * "Find leads" — paste a LinkedIn URL, get the people on it.
 *
 * One field, no scraper picker. The URL says what it is (lib/linkedin/detect.ts),
 * so the thirteen capabilities behind this are thirteen things it *recognises*
 * rather than thirteen choices to make. See docs/linkedin-sourcing-ux.md.
 */
export function FindLeadsPanel({ onQueued }: { onQueued: (jobId: string) => void }) {
  const { data } = useSWR<Jobs>("/api/linkedin/scrape");
  const [url, setUrl] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detected as they type — the confirmation is what makes this recognition
  // rather than recall.
  const detected = useMemo(() => (url.trim() ? detectScrapeKind(url) : null), [url]);
  const usage = data?.usage;

  // The extension is the whole mechanism. If it is not connected nothing below
  // can work, so it is the first thing checked rather than a footnote.
  if (usage && !usage.connected) {
    return (
      <div className="mt-5 space-y-3">
        <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3.5 text-sm text-warning-strong">
          <AlertTriangle className="h-4 w-4 shrink-0 translate-y-0.5" />
          <div>
            <p className="font-medium">Connect the browser extension first.</p>
            <p className="mt-1 text-xs">
              It reads LinkedIn from your own logged-in tab, so nothing of yours is stored on our
              servers — no password, no session.
            </p>
          </div>
        </div>
        <Link href="/dashboard/linkedin" className="btn btn-primary w-full justify-center text-sm">
          Set up the extension <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const capped = !!usage && usage.remaining <= 0;

  async function start() {
    if (!detected) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api<{ id: string }>("/api/linkedin/scrape", {
        body: { url: detected.url, maxResults: count ?? detected.info.defaultResults },
      });
      setUrl("");
      setCount(null);
      onQueued(job.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      {error && <Banner kind="error">{error}</Banner>}

      <div>
        <Label htmlFor="li-url">LinkedIn URL</Label>
        <Input
          id="li-url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/search/results/people/?keywords=…"
        />
        <p className="mt-1 text-xs text-ink-faint">
          A people search, a profile, a company, a post, a group, an event, or your connections.
        </p>
      </div>

      {/* Echo back what we understood, so they confirm rather than remember. */}
      {url.trim() && !detected && (
        <p className="rounded-xl bg-tint px-3 py-2 text-xs text-ink-soft">
          We cannot read that page. {SUPPORTED_HINT}
        </p>
      )}

      {detected && (
        <>
          <div className="flex items-start gap-2.5 rounded-xl bg-tint px-3 py-2.5">
            <Linkedin className="h-4 w-4 shrink-0 translate-y-0.5 text-accent" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{detected.info.label}</p>
              <p className="text-xs text-ink-soft">{detected.info.hint}</p>
            </div>
          </div>

          {detected.info.maxResults > 1 && (
            <div>
              <Label htmlFor="li-count">How many</Label>
              <Select
                id="li-count"
                value={String(count ?? detected.info.defaultResults)}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[25, 50, 100, 250, 500, 1000]
                  .filter((n) => n <= detected.info.maxResults)
                  .map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
              </Select>
            </div>
          )}
        </>
      )}

      {capped ? (
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-strong">
          You have pulled {usage!.used} of {usage!.cap} rows today. This resets at midnight — the
          limit is what keeps your LinkedIn account healthy.
        </p>
      ) : (
        usage && (
          <p className="text-xs text-ink-faint">
            {usage.remaining.toLocaleString()} of {usage.cap.toLocaleString()} rows left today.
          </p>
        )
      )}

      <button
        onClick={start}
        disabled={!detected || busy || capped}
        className="btn btn-primary w-full justify-center text-sm disabled:opacity-50"
      >
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</> : "Start"}
      </button>

      <p className="text-center text-xs text-ink-faint">
        Runs in your own browser tab. Nothing is sent, connected or messaged — this only reads.
      </p>
    </div>
  );
}
