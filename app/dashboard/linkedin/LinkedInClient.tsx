"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Linkedin, ChevronDown, Clock, Copy, Check, RefreshCw, Eye, EyeOff,
  ExternalLink, ShieldCheck, Square, Chrome,
} from "lucide-react";
import { api } from "@/lib/client";
import { Banner, DashHeader, Input, Label, useConfirm } from "@/components/ui";
import { FindLeadsPanel } from "@/components/dashboard/FindLeadsPanel";
import { SourcingView } from "@/components/dashboard/SourcingView";
import { EXTENSION_STORE_URL } from "@/lib/constants";

/**
 * LinkedIn — one screen, for the one thing that happens here.
 *
 * This used to be three tabs, and the default one gave half its width to three
 * paragraphs about session cookies. Behind the third tab were 32 job cards, 19
 * of them greyed-out roadmap, under a heading that claimed 35. None of the cards
 * did anything: they were a `<div>`. A roadmap rendered as product surface is
 * still a roadmap, and it now lives in docs/phantombuster.md where it belongs.
 *
 * What is left is what the screen is for: getting people out of LinkedIn and
 * into the CRM, plus the state of the connection that makes it possible.
 *
 * Outreach is deliberately not here. Sending a connection request or a message
 * is a step in a campaign, next to Email and WhatsApp, because a channel is a
 * property of a step and not a place you visit. The line at the bottom of this
 * screen exists to say so, once, to anyone who came looking.
 */

type Usage = { cap: number; used: number; remaining: number; connected: boolean };
type AccountState = "disconnected" | "expiring" | "expired" | "connected";
type Connect = {
  extToken: string;
  lastSeenAt: string | null;
  dailyInviteCap: number;
  minDelaySec: number;
  maxDelaySec: number;
  autoSend: boolean;
  account: {
    state: AccountState;
    configured: boolean;
    memberName: string | null;
    pictureUrl: string | null;
    email: string | null;
    expiresAt: string | null;
    canPost: boolean;
  };
  queue: { pending: number; sentToday: number; failedToday: number };
};

const appOrigin = typeof window !== "undefined" ? window.location.origin : "https://app.followthroo.com";

const recentlySeen = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 15 * 60 * 1000;
const daysLeft = (iso: string | null) => (iso ? Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

/** LinkedIn's own cancellations are choices, not faults. */
const OAUTH_ERRORS: Record<string, string> = {
  user_cancelled_login: "You closed LinkedIn's sign-in before finishing. Nothing was connected.",
  user_cancelled_authorize: "You declined the permissions, so nothing was connected.",
  state_mismatch: "That connection link expired. Please try again.",
  could_not_read_profile: "LinkedIn accepted the login but wouldn't return your profile. Try again.",
};
const SCOPE_ERRORS = new Set(["invalid_scope_error", "unauthorized_scope_error", "invalid_scope"]);

export default function LinkedInClient() {
  const { data: scrape } = useSWR<{ usage: Usage }>("/api/linkedin/scrape");
  const { data, mutate, isLoading } = useSWR<Connect>("/api/linkedin/connect");
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [scopeError, setScopeError] = useState(false);
  const confirm = useConfirm();

  const usage = scrape?.usage;
  const acct = data?.account;
  const helperRunning = data ? recentlySeen(data.lastSeenAt) : false;
  const expiry = daysLeft(acct?.expiresAt ?? null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (connected) {
      setMsg({ kind: "success", text: connected === "1" ? "LinkedIn connected." : `Connected as ${connected}.` });
    } else if (error && SCOPE_ERRORS.has(error)) {
      setScopeError(true);
    } else if (error) {
      const known = OAUTH_ERRORS[error];
      setMsg({ kind: known ? "info" : "error", text: known ?? `Could not connect LinkedIn (${error}).` });
    }
    window.history.replaceState({}, "", window.location.pathname);
    mutate();
  }, [mutate]);

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect your LinkedIn account?",
      body: "We'll delete the stored tokens. Campaign steps that use LinkedIn will queue up until you reconnect. Your contacts are unaffected.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    await api("/api/linkedin/connect", { body: { action: "disconnect" } });
    setMsg({ kind: "info", text: "LinkedIn disconnected." });
    mutate();
  }

  return (
    <>
      <DashHeader
        title="LinkedIn"
        subtitle="Bring people into your CRM from LinkedIn. Sending happens in campaigns."
      />

      <div className="mx-auto max-w-3xl space-y-8 p-8">
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
        {scopeError && <ScopeErrorBanner />}

        {/* ---- The one thing this screen is for ---- */}
        <section>
          <h2 className="font-display text-lg font-extrabold">Bring people in</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Paste any LinkedIn page. We work out what it is — you never pick a tool.
          </p>
          <div className="mt-4">
            <FindLeadsPanel onQueued={() => mutate()} />
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            A people search, everyone at a company, who reacted to a post, a group, an event, or your
            own connections.
          </p>
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-base font-bold">Recent</h2>
            {usage && (
              <span className="font-mono text-[11px] text-ink-faint">
                {usage.remaining.toLocaleString()} of {usage.cap.toLocaleString()} rows left today
              </span>
            )}
          </div>
          <SourcingView />
        </section>

        {/* Whether anything is going out at all, and what is waiting. Above the
            account deliberately: it is the state people come here to check. */}
        <SendingPanel data={data} onChanged={mutate} setMsg={setMsg} />

        {/* ---- The connection that makes it work ---- */}
        <section className="border-t border-line pt-6">
          <h2 className="font-display text-base font-bold">Your LinkedIn</h2>

          {isLoading ? (
            <div className="mt-4 h-16 animate-pulse rounded-xl bg-tint" />
          ) : !acct?.configured ? (
            <Banner kind="error" className="mt-4">
              LinkedIn sign-in isn&apos;t configured on this deployment. Set <code>LINKEDIN_CLIENT_ID</code> and{" "}
              <code>LINKEDIN_CLIENT_SECRET</code>, and register <code>{appOrigin}/api/linkedin/oauth/callback</code> in
              the LinkedIn Developer Portal.
            </Banner>
          ) : acct.state === "disconnected" ? (
            <div className="mt-4 rounded-2xl border border-line bg-tint/30 p-5">
              <p className="text-sm text-ink-soft">
                Connect your account so we know who you are, and so campaigns can post to your feed.
              </p>
              <a href="/api/linkedin/oauth/start" className="btn btn-primary mt-4 !py-2.5 !text-sm">
                <Linkedin className="h-4 w-4" /> Connect LinkedIn
              </a>
              <p className="mt-3 text-xs text-ink-faint">
                Opens LinkedIn&apos;s own consent screen. You sign in on linkedin.com — we never see your password.
              </p>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
              {acct.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={acct.pictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0A66C2] font-display text-sm font-bold text-white">
                  {(acct.memberName ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-bold">{acct.memberName ?? "LinkedIn member"}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {acct.canPost ? "Can post to your feed" : "Identity only"}
                  </span>
                  {expiry !== null && (
                    <span className={expiry <= 7 ? "text-warning" : ""}>
                      {expiry < 0 ? "Expired" : `Renews in ${expiry} day${expiry === 1 ? "" : "s"}`}
                    </span>
                  )}
                </div>
              </div>
              {(acct.state === "expiring" || acct.state === "expired") && (
                <a href="/api/linkedin/oauth/start" className="btn btn-primary !py-1.5 !text-xs">
                  <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                </a>
              )}
              <button onClick={disconnect} className="btn btn-ghost !py-1.5 !text-xs">Disconnect</button>
            </div>
          )}

          {/* Reading LinkedIn pages needs the browser helper, which is a
              different thing from the account and only matters when it is not
              running — so it stays folded away until it does. */}
          <BrowserHelper data={data} running={helperRunning} onChange={mutate} setMsg={setMsg} />
          <Limits data={data} onSaved={mutate} setMsg={setMsg} />
        </section>

        <p className="border-t border-line pt-6 text-sm text-ink-soft">
          Sending connection requests and messages?{" "}
          <Link href="/dashboard/campaigns" className="font-medium text-ink underline">
            Those are campaign steps
          </Link>
          , alongside email and WhatsApp — so one sequence can use all three.
        </p>
      </div>
    </>
  );
}

/** The operator-facing fix for the one error that stops connecting entirely. */
function ScopeErrorBanner() {
  return (
    <Banner kind="error">
      <div className="space-y-2">
        <p className="font-semibold">LinkedIn refused the permissions this app asked for.</p>
        <p>
          LinkedIn fails the whole consent when an app requests a permission it hasn&apos;t been granted, rather than
          skipping that one. In the{" "}
          <a
            href="https://www.linkedin.com/developers/apps"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            Developer Portal <ExternalLink className="h-3 w-3" />
          </a>{" "}
          open your app → <b>Products</b> and add <b>Sign In with LinkedIn using OpenID Connect</b> and{" "}
          <b>Share on LinkedIn</b>. Both are self-serve once the app is linked to a LinkedIn Page you can verify.
        </p>
      </div>
    </Banner>
  );
}

function Disclosure({
  title,
  summary,
  children,
  tone,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <details className="group mt-3 rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className={`mt-0.5 text-xs ${tone === "warning" ? "text-warning" : "text-ink-soft"}`}>{summary}</div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-soft transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

/**
 * Whether the product is sending on your behalf, and what is waiting.
 *
 * This was a checkbox inside the collapsed "Limits" disclosure. Two things went
 * wrong with that and both are fixed here. The checkbox opened a confirmation
 * modal, so clicking it appeared to do nothing and dismissing the modal sprang
 * it back with no explanation — it read "on" to the person and `false` to the
 * database for days. And being inside a disclosure meant the state was invisible
 * unless you went looking, along with a queue of 58 stuck behind one draft.
 *
 * So: committed state only, always on screen, and the queue next to it.
 */
function SendingPanel({
  data,
  onChanged,
  setMsg,
}: {
  data?: Connect;
  onChanged: () => void;
  setMsg: (m: { kind: "error" | "success" | "info"; text: string }) => void;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const on = !!data?.autoSend;
  const q = data?.queue;

  async function setAuto(next: boolean) {
    if (next) {
      const ok = await confirm({
        title: "Send automatically?",
        body: "Connection requests and messages will go out on their own, from your browser, without you reviewing each one. This is against LinkedIn's User Agreement and accounts do get restricted for it. You can stop it at any time.",
        confirmLabel: "Turn it on",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api("/api/linkedin/connect", { body: { action: "update", autoSend: next } });
      setMsg({
        kind: "success",
        text: next ? "Sending automatically now." : "Back to drafting — you send each one.",
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function stopAll() {
    const ok = await confirm({
      title: "Stop everything?",
      body: "Turns automatic sending off and cancels everything still queued. Nothing already sent is affected.",
      confirmLabel: "Stop everything",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ cleared: number }>("/api/linkedin/connect", { body: { action: "stop_all" } });
      setMsg({ kind: "success", text: `Stopped. ${res.cleared} queued action${res.cleared === 1 ? "" : "s"} cancelled.` });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-bold">Sending</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                on ? "bg-success/10 text-success" : "bg-tint text-ink-soft"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-success" : "bg-ink-faint"}`} />
              {on ? "Automatic" : "You review each one"}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">
            {on
              ? `Invites go out on their own, one every ${data?.minDelaySec ?? 45}–${data?.maxDelaySec ?? 120} seconds, up to ${data?.dailyInviteCap ?? 20} a day.`
              : "Each invite opens a tab with the text filled in. Nothing goes out until you press send."}
          </p>
        </div>
        <button
          onClick={() => setAuto(!on)}
          disabled={busy}
          className={`btn shrink-0 !py-2 !text-sm ${on ? "btn-ghost" : "btn-primary"}`}
        >
          {on ? "Turn off" : "Send automatically"}
        </button>
      </div>

      {/* The counts that were hidden. 58 queued behind a stuck draft should never
          have taken a database query to discover. */}
      {q && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-3 text-sm">
          <span className={q.pending > 0 ? "font-medium" : "text-ink-soft"}>
            <b className="font-display text-lg">{q.pending}</b> queued
          </span>
          <span className="text-ink-soft">
            <b className="font-display text-lg text-ink">{q.sentToday}</b> sent today
          </span>
          {q.failedToday > 0 && (
            <span className="text-danger">
              <b className="font-display text-lg">{q.failedToday}</b> failed today
            </span>
          )}
          {on && q.pending > 0 && (
            <button onClick={stopAll} disabled={busy} className="btn btn-ghost ml-auto !py-1 !text-xs !text-danger">
              <Square className="h-3.5 w-3.5" /> Stop everything
            </button>
          )}
        </div>
      )}

      {!on && (q?.pending ?? 0) > 0 && (
        <p className="mt-3 rounded-lg bg-tint px-3 py-2 text-xs text-ink-soft">
          {q!.pending} waiting. With review on, each one needs a tab opened and sent by hand — turn on automatic
          sending and they go out on their own.
        </p>
      )}
    </section>
  );
}

function BrowserHelper({
  data,
  running,
  onChange,
  setMsg,
}: {
  data?: Connect;
  running: boolean;
  onChange: () => void;
  setMsg: (m: { kind: "error" | "success" | "info"; text: string }) => void;
}) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();

  async function rotate() {
    const ok = await confirm({
      title: "Rotate the pairing token?",
      body: "The current token stops working immediately. Paste the new one into the extension before it can read again.",
      confirmLabel: "Rotate",
      tone: "danger",
    });
    if (!ok) return;
    await api("/api/linkedin/connect", { body: { action: "rotate" } });
    setMsg({ kind: "success", text: "Token rotated. Paste the new one into the extension." });
    onChange();
  }

  return (
    <Disclosure
      title="Browser helper"
      summary={running ? "Running — reading pages in your own tab" : "Not running. Reading LinkedIn pages needs it."}
      tone={running ? undefined : "warning"}
    >
      <p className="text-sm text-ink-soft">
        LinkedIn&apos;s API cannot read search results, so reading happens in your own logged-in tab through a small
        Chrome extension. Nothing about your login reaches us.
      </p>

      <div className="mt-4">
        <Label>Pairing token</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Input readOnly value={show ? data?.extToken ?? "" : "•".repeat(28)} className="!pr-10 font-mono" />
            <button
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink"
              aria-label="Toggle token visibility"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={() => {
              if (!data) return;
              navigator.clipboard.writeText(data.extToken);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn btn-ghost !py-2 !text-sm"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={rotate} className="btn btn-ghost !py-2 !text-sm">
            <RefreshCw className="h-4 w-4" /> Rotate
          </button>
        </div>
      </div>

      <ol className="mt-4 space-y-1.5 text-sm text-ink-soft">
        <li>
          <b className="text-ink">1.</b> Install <b>Followthroo for LinkedIn</b> from the{" "}
          <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="underline">
            Chrome Web Store
          </a>
          .
        </li>
        <li><b className="text-ink">2.</b> Click its icon → Settings → App URL <code>{appOrigin}</code>, paste the token, Connect.</li>
        <li><b className="text-ink">3.</b> Stay signed in to LinkedIn in the same browser.</li>
      </ol>
      <a
        href={EXTENSION_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-ghost mt-3 !py-2 !text-sm"
      >
        <Chrome className="h-4 w-4" /> Add to Chrome
      </a>
      <p className="mt-3 text-xs text-ink-faint">
        <Link href="/extension-privacy" className="underline">What it can access</Link>
      </p>
    </Disclosure>
  );
}

function Limits({
  data,
  onSaved,
  setMsg,
}: {
  data?: Connect;
  onSaved: () => void;
  setMsg: (m: { kind: "error" | "success" | "info"; text: string }) => void;
}) {
  const [cap, setCap] = useState<number | "">("");
  const [minD, setMinD] = useState<number | "">("");
  const [maxD, setMaxD] = useState<number | "">("");

  async function save() {
    const body: Record<string, number> = {};
    if (cap !== "") body.dailyInviteCap = Number(cap);
    if (minD !== "") body.minDelaySec = Number(minD);
    if (maxD !== "") body.maxDelaySec = Number(maxD);
    if (!Object.keys(body).length) return;
    await api("/api/linkedin/connect", { body: { action: "update", ...body } });
    setMsg({ kind: "success", text: "Limits saved." });
    setCap(""); setMinD(""); setMaxD("");
    onSaved();
  }

  return (
    <Disclosure
      title="Limits"
      summary={`${data?.dailyInviteCap ?? 20} actions a day, ${data?.minDelaySec ?? 45}–${data?.maxDelaySec ?? 120}s apart`}
    >
      <p className="text-sm text-ink-soft">
        Set once and rarely touched. These exist to keep your account in good standing, not to ration you — LinkedIn
        restricts accounts that behave like software.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <Label>Actions per day</Label>
          <Input type="number" min={1} max={50} placeholder={String(data?.dailyInviteCap ?? 20)} value={cap} onChange={(e) => setCap(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div>
          <Label>Min gap (sec)</Label>
          <Input type="number" min={10} placeholder={String(data?.minDelaySec ?? 45)} value={minD} onChange={(e) => setMinD(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div>
          <Label>Max gap (sec)</Label>
          <Input type="number" min={15} placeholder={String(data?.maxDelaySec ?? 120)} value={maxD} onChange={(e) => setMaxD(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
        <Clock className="h-3.5 w-3.5" /> A random pause inside that range is taken between actions.
      </div>
      <button onClick={save} className="btn btn-primary mt-4 !py-2 !text-sm">Save limits</button>
      {data && (data.queue.pending > 0 || data.queue.sentToday > 0 || data.queue.failedToday > 0) && (
        <div className="mt-4 flex gap-4 border-t border-line pt-3 text-xs text-ink-soft">
          <span><b className="text-ink">{data.queue.pending}</b> queued</span>
          <span><b className="text-ink">{data.queue.sentToday}</b> sent today</span>
          {data.queue.failedToday > 0 && <span className="text-danger"><b>{data.queue.failedToday}</b> failed</span>}
        </div>
      )}
    </Disclosure>
  );
}

