"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient, signUp } from "@/lib/auth-client";
import { SocialSignIn } from "@/components/auth/SocialSignIn";

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 26 26" fill="none" aria-hidden>
      <line x1="7" y1="13" x2="19" y2="13" stroke="var(--color-action)" strokeWidth="2.4" />
      <circle cx="7" cy="13" r="5" fill="var(--color-brand)" />
      <circle cx="19" cy="13" r="5" fill="var(--color-canvas)" stroke="var(--color-brand)" strokeWidth="2.4" />
    </svg>
  );
}

/**
 * Create an account, then confirm the email address.
 *
 * Password sign-ups used to be marked verified the moment they were created, so
 * an address was never proven to belong to whoever typed it. With Google trusted
 * for account linking, that let someone register another person's email with a
 * password of their own — and keep that password working after the real owner
 * later signed in with Google. The account now waits for the emailed link.
 * Google and Zoho sign-ups are unaffected: those providers already confirmed the
 * address.
 */
function SignUpForm() {
  const params = useSearchParams();
  // Where to land once confirmed — usually an invitation link.
  const redirect = params.get("redirect") || "/dashboard";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signUp.email({ name, email, password, callbackURL: redirect });
    setBusy(false);
    if (error) return setErr(error.message || "Sign up failed");
    setSentTo(email);
  }

  async function resend() {
    if (!sentTo) return;
    setErr(null);
    setResent(false);
    const { error } = await authClient.sendVerificationEmail({ email: sentTo, callbackURL: redirect });
    if (error) return setErr(error.message || "Could not send the email again");
    setResent(true);
  }

  const signInHref = redirect === "/dashboard" ? "/sign-in" : `/sign-in?redirect=${encodeURIComponent(redirect)}`;

  if (sentTo) {
    return (
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-2 font-display text-xl font-bold">
          <Mark /> Followthroo
        </Link>
        <h1 className="font-display text-3xl font-extrabold">Check your inbox</h1>
        <p className="mt-2 text-sm text-ink-soft">
          We sent a link to <b className="text-ink">{sentTo}</b>. Open it to confirm the address, and you&apos;re in.
        </p>
        {err && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
        {resent && <p className="mt-4 text-sm text-ink-soft">Sent again. It can take a minute — check spam as well.</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={resend} className="btn btn-ghost !py-2 !text-sm">Send it again</button>
          <button
            type="button"
            onClick={() => { setSentTo(null); setResent(false); setErr(null); }}
            className="btn btn-ghost !py-2 !text-sm"
          >
            Use a different email
          </button>
        </div>
        <p className="mt-6 text-sm text-ink-soft">
          Already confirmed? <Link href={signInHref} className="font-medium text-ink underline">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="mb-8 flex items-center gap-2 font-display text-xl font-bold">
        <Mark /> Followthroo
      </Link>
      <h1 className="font-display text-3xl font-extrabold">Create your account</h1>
      <p className="mt-2 text-sm text-ink-soft">Start reaching leads where they reply.</p>

      <div className="mt-8">
        <SocialSignIn mode="sign-up" callbackURL={redirect} />
      </div>
      <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        {err && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
        <div>
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-ink-soft">Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-ink" placeholder="Jane Doe" />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-ink-soft">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-ink" placeholder="you@company.com" />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-ink-soft">Password</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-ink" placeholder="At least 8 characters" />
        </div>
        <button disabled={busy} className="btn btn-primary w-full justify-center disabled:opacity-50">{busy ? "Creating…" : "Create account"}</button>
        <p className="text-xs text-ink-faint">We&apos;ll email you a link to confirm the address before you can sign in.</p>
      </form>

      <p className="mt-6 text-sm text-ink-soft">
        Already have an account? <Link href={signInHref} className="font-medium text-ink underline">Sign in</Link>
      </p>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 glow-brand" />
      <Suspense>
        <SignUpForm />
      </Suspense>
    </main>
  );
}
