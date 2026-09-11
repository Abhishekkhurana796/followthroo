"use client";

import React, { useEffect, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { getCookieConsent } from "@/components/site/CookieConsent";
import { isAppPath } from "@/lib/marketing-paths";

// No fallback to a real ID: every integration in this codebase is inert until
// its own env var is set (see .env.example's own header), so a fork or a
// stray preview deploy never silently sends its traffic to someone else's
// Analytics property.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function GoogleAnalytics() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (isAppPath(pathname)) return;
    // Initial check
    if (getCookieConsent() === "accepted") {
      setEnabled(true);
    }

    // Listen for real-time consent changes from CookieConsent banner
    const handleConsentChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail === "accepted") {
        setEnabled(true);
      } else {
        setEnabled(false);
      }
    };

    window.addEventListener("ft-consent-change", handleConsentChange);
    return () => window.removeEventListener("ft-consent-change", handleConsentChange);
  }, [pathname]);

  if (isAppPath(pathname) || !enabled || !GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script
        id="google-analytics-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}', {
              page_path: window.location.pathname,
              anonymize_ip: true
            });
          `,
        }}
      />
    </>
  );
}
