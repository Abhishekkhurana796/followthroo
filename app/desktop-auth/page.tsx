"use client";

import { useEffect, useState } from "react";

/**
 * The last step of desktop sign-in, shown in the real browser.
 *
 * The desktop app cannot show Google's sign-in page — Google rejects embedded
 * browsers — so the app opens the system browser instead. Once that browser has
 * a session, this page turns it into a one-time code and hands it back over the
 * `followthroo://` protocol.
 *
 * It is deliberately a dead end for anyone who arrives without a session: the
 * API refuses, and the page says so rather than bouncing them somewhere.
 */
export default function DesktopAuthPage() {
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/desktop/handoff", { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Could not complete sign-in.");
        }
        if (cancelled) return;
        setState("done");
        // Hands off to the app. The code is single-use and expires in two
        // minutes, so it being briefly visible in a URL is survivable in a way
        // that a session token would not be.
        window.location.href = `followthroo://auth?code=${encodeURIComponent(json.data.code)}`;
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
        {state === "working" && (
          <>
            <h1 className="font-display text-xl font-extrabold">Signing you in…</h1>
            <p className="mt-2 text-sm text-ink-soft">One moment.</p>
          </>
        )}

        {state === "done" && (
          <>
            <h1 className="font-display text-xl font-extrabold">You&apos;re signed in</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Your browser may ask permission to open Followthroo. Say yes, then you can close this tab.
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <h1 className="font-display text-xl font-extrabold">That didn&apos;t work</h1>
            <p className="mt-2 text-sm text-ink-soft">{error}</p>
            <a href="/sign-in?desktop=1" className="btn btn-primary mt-5 !py-2.5 !text-sm">
              Try signing in again
            </a>
          </>
        )}
      </div>
    </main>
  );
}
