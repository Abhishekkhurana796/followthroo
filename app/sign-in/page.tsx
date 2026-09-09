"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { ZohoButton } from "@/components/auth/ZohoButton";

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 26 26" fill="none" aria-hidden>
      <line x1="7" y1="13" x2="19" y2="13" stroke="var(--color-action)" strokeWidth="2.4" />
      <circle cx="7" cy="13" r="5" fill="var(--color-brand)" />
      <circle cx="19" cy="13" r="5" fill="var(--color-canvas)" stroke="var(--color-brand)" strokeWidth="2.4" />
    </svg>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) return setErr(error.message || "Sign in failed");
    router.push(redirect);
  }

  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="mb-8 flex items-center gap-2 font-display text-xl font-bold">
        <Mark /> Followthroo
      </Link>
      <h1 className="font-display text-3xl font-extrabold">Welcome back</h1>
      <p className="mt-2 text-sm text-ink-soft">Sign in to your outreach command center.</p>

      <div className="mt-8">
        <GoogleButton callbackURL={redirect} label="Sign in with Google" />
        <ZohoButton callbackURL={redirect} label="Sign in with Zoho" />
      </div>
      <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        {err && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
        <div>
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-ink-soft">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-ink" placeholder="you@company.com" />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-ink-soft">Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-ink" placeholder="••••••••" />
        </div>
        <button disabled={busy} className="btn btn-primary w-full justify-center disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
      </form>

      <p className="mt-6 text-sm text-ink-soft">
        No account? <Link href="/sign-up" className="font-medium text-ink underline">Create one</Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 glow-brand" />
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
