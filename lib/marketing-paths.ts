/**
 * Is this pathname the product, not the marketing showcase site?
 *
 * Mirrors `APP_PATH_PREFIXES` in middleware.ts — kept as a separate, small,
 * client-safe copy rather than importing that file, since middleware.ts pulls
 * in `next/server` and better-auth's cookie helpers, neither of which belong
 * in a client bundle. Used by CookieConsent and GoogleAnalytics to self-exclude
 * from the authenticated dashboard: a customer mid-work in their CRM has
 * consented to nothing and isn't marketing-site traffic, so neither the
 * consent banner nor analytics should ever reach there.
 */
const APP_PATH_PREFIXES = ["/dashboard", "/sign-in", "/sign-up", "/accept-invitation", "/desktop-auth"];

export function isAppPath(pathname: string): boolean {
  return APP_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
