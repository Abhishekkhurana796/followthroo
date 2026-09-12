/**
 * Is this page open inside the Followthroo desktop app?
 *
 * The app shows the hosted web app in an embedded view, and Google will not
 * sign anyone in there. Knowing where we are lets the sign-in pages offer the
 * one thing that works — finishing in the browser — instead of buttons that
 * open Chrome and never come back.
 *
 * Builds from 1.13.0 say so outright. Builds already installed only carry
 * Electron's default user agent, which names both the app and Electron;
 * recognising that fixes them with a web deploy, without waiting on an update.
 */
export function isDesktopApp(userAgent: string): boolean {
  if (/\bFollowthrooDesktop\//.test(userAgent)) return true;
  return /\bElectron\//.test(userAgent) && /followthroo/i.test(userAgent);
}

/**
 * Where the browser half of a desktop sign-in starts.
 *
 * `/desktop-auth` at the end of it turns the browser's session into a one-time
 * code and hands it back to the app over `followthroo://`.
 */
export function desktopHandoffUrl(mode: "sign-in" | "sign-up") {
  return `/${mode}?redirect=${encodeURIComponent("/desktop-auth")}`;
}
