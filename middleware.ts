import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Two production domains, one deployment: followthroo.com is the public
 * showcase site, app.followthroo.com is the product. Both point at this same
 * Next.js app — the split is host-based routing here, not two builds.
 *
 * Deliberately scoped to these exact hostnames so localhost and Vercel
 * preview URLs (*.vercel.app) are completely unaffected — only real
 * production traffic on the two custom domains gets redirected.
 */
const MARKETING_HOST = "followthroo.com";
const APP_HOST = "app.followthroo.com";

/** Everything that is the product, not the showcase site. `/api` is deliberately
 *  excluded — see below. */
// `/desktop-auth` is the last hop of desktop sign-in: the system browser lands
// there with a fresh session and hands a one-time code to the app. It belongs on
// the app host with the other authenticated paths — bounced to the marketing
// site it would lose the session it exists to read.
const APP_PATH_PREFIXES = ["/dashboard", "/sign-in", "/sign-up", "/accept-invitation", "/desktop-auth"];

function isAppPath(pathname: string) {
  return APP_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.split(":")[0] ?? "";
  const { pathname, search } = req.nextUrl;
  const isMarketingHost = host === MARKETING_HOST || host === `www.${MARKETING_HOST}`;
  const isAppHost = host === APP_HOST;

  // API routes are never redirected between hosts: third-party webhooks are handed
  // the app.followthroo.com URL directly (lib/lead-sources.ts), the marketing site
  // never calls /api itself, and redirecting a POST can silently turn it into a GET.
  if (!pathname.startsWith("/api")) {
    if (isMarketingHost && isAppPath(pathname)) {
      return NextResponse.redirect(`https://${APP_HOST}${pathname}${search}`, { status: 307 });
    }
    if (isAppHost) {
      if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", req.url));
      if (!isAppPath(pathname)) {
        return NextResponse.redirect(`https://${MARKETING_HOST}${pathname}${search}`, { status: 307 });
      }
    }
  }

  // Optimistic gate: redirects to /sign-in if no session cookie is present.
  // (Server routes still validate the session; this just avoids flashing the app.)
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie) {
      const url = new URL("/sign-in", req.url);
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets / Next internals, so the host-based
  // redirect above can see marketing and app paths alike.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
