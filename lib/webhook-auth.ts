/**
 * Authentication for webhooks posted by third parties.
 *
 * These endpoints have no session — they are called by Twilio, an email
 * provider, or a lead aggregator — and they *write tenant data*: suppressions,
 * activity logs, replies. Unauthenticated, they let anyone unsubscribe another
 * workspace's contacts or forge a reply. Every one of them must go through
 * something here.
 *
 * All comparisons are constant time. A fast `!==` on a secret leaks its prefix
 * one byte at a time to anyone willing to measure.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string equality that does not leak length through early exit. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  // Hash both sides first so the compared buffers are always the same length —
  // timingSafeEqual throws on a length mismatch, which would itself be an oracle.
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify Twilio's `X-Twilio-Signature`.
 *
 * Twilio signs the full request URL concatenated with every POST parameter
 * sorted by key. The URL must be the one Twilio was configured with — behind a
 * proxy `req.url` can be the internal one, so the public app URL is used.
 */
export function verifyTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
  authToken: string | undefined
): boolean {
  if (!signature || !authToken) return false;
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  return safeEqual(signature, expected);
}

/**
 * Shared-secret check for providers that do not sign, or sign in a format we
 * have not implemented. Accepts the secret as `X-Webhook-Secret` or `?key=`.
 *
 * Returns false when no secret is configured — fail closed. An unauthenticated
 * webhook that writes to tenant data is worse than a webhook that is off.
 */
export function verifySharedSecret(req: Request, envVar: string): boolean {
  const expected = process.env[envVar];
  if (!expected) return false;
  const header = req.headers.get("x-webhook-secret");
  if (safeEqual(header, expected)) return true;
  try {
    return safeEqual(new URL(req.url).searchParams.get("key"), expected);
  } catch {
    return false;
  }
}

/**
 * Generic HMAC-SHA256 signature over the raw body, as used by most email
 * providers. `header` is the value the provider sent; `prefix` strips a scheme
 * marker such as "sha256=".
 */
export function verifyBodyHmac(rawBody: string, header: string | null, secret: string | undefined, prefix = "sha256="): boolean {
  if (!header || !secret) return false;
  const provided = header.startsWith(prefix) ? header.slice(prefix.length) : header;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(provided, expected);
}
