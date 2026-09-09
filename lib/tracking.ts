/**
 * Email open/click tracking.
 *
 * Before an email is sent we rewrite outbound links to a click-redirector and append a
 * 1×1 open pixel — both keyed by the Message id. The tracking routes (unauthenticated,
 * hit from the recipient's inbox) resolve the Message, write an ActivityLog(opened|clicked),
 * and — for clicks — 302 to the original URL. Reports and the campaign condition nodes
 * ("opened" / "clicked") read those events.
 */
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./webhook-auth";

/** 1×1 transparent GIF. */
export const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const HREF_RE = /href\s*=\s*"(https?:\/\/[^"]+)"/gi;

/**
 * Sign a click destination so the redirector cannot be pointed anywhere else.
 *
 * Without this, /api/track/click/<id>?u=https://evil.com is an open redirect on
 * an unauthenticated route — a phishing link laundered through our own domain,
 * which is exactly the reputational damage a sending platform cannot afford.
 * Bound to the message id so a signature lifted from one email cannot be
 * replayed on another.
 */
export function signClickTarget(messageId: string, url: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.APP_SECRET ?? "";
  return createHmac("sha256", secret).update(`click:${messageId}:${url}`).digest("hex").slice(0, 32);
}

export function verifyClickTarget(messageId: string, url: string, signature: string | null): boolean {
  return safeEqual(signature, signClickTarget(messageId, url));
}

/** Rewrite links + inject the open pixel. Only touches http(s) links. */
export function injectTracking(html: string, messageId: string, appUrl = env.appUrl): string {
  const base = appUrl.replace(/\/$/, "");

  const rewritten = html.replace(HREF_RE, (_m, url: string) => {
    // Don't double-wrap our own tracking/unsubscribe links.
    if (url.startsWith(`${base}/api/track/`)) return `href="${url}"`;
    const sig = signClickTarget(messageId, url);
    return `href="${base}/api/track/click/${messageId}?u=${encodeURIComponent(url)}&s=${sig}"`;
  });

  const pixel = `<img src="${base}/api/track/open/${messageId}" width="1" height="1" alt="" style="display:none;border:0" />`;
  return /<\/body>/i.test(rewritten)
    ? rewritten.replace(/<\/body>/i, `${pixel}</body>`)
    : rewritten + pixel;
}
