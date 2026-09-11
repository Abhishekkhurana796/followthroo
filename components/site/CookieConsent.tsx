"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cookie, ShieldCheck, X } from "lucide-react";
import { isAppPath } from "@/lib/marketing-paths";

export function getCookieConsent(): "accepted" | "rejected" | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )ft-consent=([^;]*)/);
  if (!match) return null;
  return match[1] === "accepted" ? "accepted" : match[1] === "rejected" ? "rejected" : null;
}

export function setCookieConsent(status: "accepted" | "rejected") {
  if (typeof document === "undefined") return;
  const maxAge = 365 * 24 * 60 * 60; // 1 year
  document.cookie = `ft-consent=${status}; path=/; max-age=${maxAge}; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent("ft-consent-change", { detail: status }));
}

export default function CookieConsent() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    if (isAppPath(pathname)) return;
    const consent = getCookieConsent();
    if (consent === null) {
      // Delay slightly for smooth page entry
      const timer = setTimeout(() => setShow(true), 800);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  if (isAppPath(pathname) || !show) return null;

  const handleAccept = () => {
    setCookieConsent("accepted");
    setShow(false);
  };

  const handleReject = () => {
    setCookieConsent("rejected");
    setShow(false);
  };

  return (
    <aside
      aria-label="Cookie preferences"
      className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-4xl animate-in fade-in-0 slide-in-from-bottom-4 duration-300"
    >
      <div className="relative overflow-hidden rounded-3xl border border-line bg-surface/95 p-6 shadow-2xl backdrop-blur-xl sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Cookie className="h-5.5 w-5.5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-display text-base font-bold text-ink">
                <span>We value your privacy</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
                  <ShieldCheck className="h-3 w-3" /> GDPR Compliant
                </span>
              </div>
              <p className="text-xs leading-relaxed text-ink-soft max-w-xl">
                We use cookies and analytics tools to understand site traffic and optimize campaign workflows. You can change your choices anytime in our{" "}
                <Link href="/privacy" className="text-accent underline font-medium hover:text-accent-strong">
                  Privacy Policy
                </Link>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0">
            {customizing ? (
              <>
                <button
                  onClick={handleReject}
                  className="btn btn-ghost !py-2 !px-3.5 !text-xs"
                >
                  Essential Only
                </button>
                <button
                  onClick={handleAccept}
                  className="btn btn-primary !py-2 !px-4 !text-xs"
                >
                  Accept All
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setCustomizing(true)}
                  className="btn btn-ghost !py-2 !px-3 !text-xs"
                >
                  Preferences
                </button>
                <button
                  onClick={handleReject}
                  className="btn btn-ghost !py-2 !px-3.5 !text-xs"
                >
                  Decline
                </button>
                <button
                  onClick={handleAccept}
                  className="btn btn-primary !py-2 !px-4 !text-xs"
                >
                  Accept All
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
