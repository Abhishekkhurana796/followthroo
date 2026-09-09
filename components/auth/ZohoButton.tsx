"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * "Continue with Zoho" — better-auth has no built-in Zoho provider, so this goes
 * through the genericOAuth plugin (`signIn.oauth2`) rather than `signIn.social`.
 *
 * Identity only. Permission to send mail as this person is a separate consent
 * from Settings → Accounts; asking for mailbox access just to sign up would be
 * the wrong trade for someone who has not decided to use the product yet.
 */
export function ZohoButton({
  callbackURL = "/dashboard",
  label = "Continue with Zoho",
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
      const res = await authClient.signIn.oauth2({ providerId: "zoho", callbackURL });
      // Still here means no redirect happened — usually ZOHO_CLIENT_ID/SECRET
      // missing on the server, so the provider was never registered.
      if (res?.error) {
        setErr(
          res.error.message ||
            "Zoho sign-in is unavailable. Check ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET on the server."
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Zoho sign-in failed");
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
        {/* Zoho's four-bar mark, simplified. */}
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="0" y="4" width="3.6" height="10" rx="1" fill="#E42527" />
          <rect x="4.8" y="4" width="3.6" height="10" rx="1" fill="#089949" />
          <rect x="9.6" y="4" width="3.6" height="10" rx="1" fill="#226DB4" />
          <rect x="14.4" y="4" width="3.6" height="10" rx="1" fill="#F9B21D" />
        </svg>
        {busy ? "Redirecting…" : label}
      </button>
      {err && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>
      )}
    </div>
  );
}
