// Small, cross-cutting constants that don't belong to any one feature.

/**
 * The published Chrome Web Store listing for "Followthroo for LinkedIn".
 * One place to change it — every install prompt in the app links here.
 */
export const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/cnchieebjaempffnhdbfnhpidfoamocp";

/**
 * Where the Windows app (`desktop/`) is published.
 *
 * Set `NEXT_PUBLIC_DESKTOP_APP_URL` to the installer's public URL. There is no
 * default on purpose: an unset value renders "ask your admin" rather than a
 * button that 404s, and a broken download of the thing that does the sending is
 * indistinguishable from the product being broken.
 *
 * The file is ~80MB, so it does not belong in `public/` — that would ride along
 * in every deployment. Host it as an object (Vercel Blob, R2, S3) or a GitHub
 * release asset on a public repo, and point this at it.
 */
export const DESKTOP_APP_URL = process.env.NEXT_PUBLIC_DESKTOP_APP_URL ?? "";
