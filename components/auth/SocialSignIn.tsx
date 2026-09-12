"use client";

import { useEffect, useState } from "react";
import { GoogleButton } from "./GoogleButton";
import { ZohoButton } from "./ZohoButton";
import { desktopHandoffUrl, isDesktopApp } from "@/lib/desktop-app";

/**
 * The Google and Zoho buttons — or, inside the desktop app, the way round them.
 *
 * Google refuses to sign anyone in inside an embedded browser, and the desktop
 * app's window is one. Clicking Google there used to open Chrome, sign Chrome
 * in, and leave the app exactly as signed out as before. So inside the app this
 * offers the browser handoff instead. Email and password work in place and are
 * untouched.
 *
 * Decided after mount rather than during render: the server has no user agent to
 * go on, and guessing would put a hydration mismatch on every sign-in page.
 */
export function SocialSignIn({ mode, callbackURL }: { mode: "sign-in" | "sign-up"; callbackURL: string }) {
  const [inDesktop, setInDesktop] = useState(false);

  useEffect(() => {
    setInDesktop(isDesktopApp(navigator.userAgent));
  }, []);

  const verb = mode === "sign-in" ? "Sign in" : "Sign up";

  if (inDesktop) {
    return (
      <div>
        {/* A new window, which the desktop app hands to the system browser. */}
        <a
          href={desktopHandoffUrl(mode)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost w-full justify-center"
        >
          {verb} with Google or Zoho in your browser
        </a>
        <p className="mt-2 text-xs text-ink-soft">
          Google doesn&apos;t allow signing in inside apps. Finish in your browser and you&apos;ll come straight back here.
        </p>
      </div>
    );
  }

  return (
    <>
      <GoogleButton callbackURL={callbackURL} label={`${verb} with Google`} />
      <ZohoButton callbackURL={callbackURL} label={`${verb} with Zoho`} />
    </>
  );
}
