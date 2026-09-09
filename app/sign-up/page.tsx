"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth-client";
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

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signUp.email({ name, email, password });
    setBusy(false);
    if (error) return setErr(error.message || "Sign up failed");
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 glow-brand" />
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-2 font-display text-xl font-bold">
          <Mark /> Followthroo
        </Link>
        <h1 className="font-display text-3xl font-extrabold">Create your account</h1>
        <p className="mt-2 text-sm text-ink-soft">Start reaching leads where they reply.</p>

        <div className="mt-8">
          <GoogleButton callbackURL="/dashboard" label="Sign up with Google" />
          <ZohoButton callbackURL="/dashboard" label="Sign up with Zoho" />
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
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          Already have an account? <Link href="/sign-in" className="font-medium text-ink underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
