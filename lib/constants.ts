// Small, cross-cutting constants that don't belong to any one feature.

/**
 * The published Chrome Web Store listing for "Followthroo for LinkedIn".
 * One place to change it — every install prompt in the app links here.
 */
export const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/cnchieebjaempffnhdbfnhpidfoamocp";

/**
 * The Windows app (`desktop/`) currently on offer.
 *
 * Bump this in the same commit as `desktop/package.json`'s version, and upload
 * the installer to the matching pathname. Artifacts are immutable — one blob
 * per version — because the first arrangement overwrote a single fixed pathname
 * and blob objects carry a thirty-day cache: edges kept serving the previous
 * build, so "download the latest" quietly handed people the bug they had just
 * reported.
 */
export const DESKTOP_APP_VERSION = "1.6.0";

/** Where the versioned installers live. Without it, downloads are unavailable. */
const DESKTOP_BLOB_BASE = process.env.NEXT_PUBLIC_DESKTOP_BLOB_BASE ?? "";

export function desktopInstallerUrl(version = DESKTOP_APP_VERSION): string {
  return `${DESKTOP_BLOB_BASE.replace(/\/+$/, "")}/followthroo-linkedin-setup-${version}.exe`;
}

/**
 * What the UI links to.
 *
 * A route rather than the blob directly, so the version lives in one constant
 * instead of an environment variable that has to be edited on every release —
 * and so a `NEXT_PUBLIC_*` value, which is inlined at build time, never has to
 * change to ship a new build.
 *
 * Empty when no blob base is configured: an unset value renders "ask your
 * admin" rather than a button that 404s, and a broken download of the thing
 * that does the sending is indistinguishable from the product being broken.
 */
export const DESKTOP_APP_URL = DESKTOP_BLOB_BASE ? "/api/desktop/download" : "";
