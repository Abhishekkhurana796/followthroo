"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";

/** "Continue with Google" — kicks off better-auth's Google social login. */
export function GoogleButton({
  callbackURL = "/dashboard",
  label = "Continue with Google",
}: {
  callbackURL?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      // Redirects to Google on success; better-auth handles the callback + session.
      const res = await signIn.social({ provider: "google", callbackURL });
      // If we're still here, no redirect happened — surface why (common on deploys:
      // GOOGLE_CLIENT_ID/SECRET not set, so the provider isn't registered server-side).
      if (res?.error) {
        setErr(
          res.error.message ||
            "Google sign-in is unavailable. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the server."
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium transition hover:bg-tint disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
          <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
        </svg>
        {busy ? "Redirecting…" : label}
      </button>
      {err && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>
      )}
    </div>
  );
}
