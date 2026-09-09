import crypto from "node:crypto";

/**
 * Per-org key authenticating third-party webhook posts to /api/inbound/*.
 *
 * Derived from the app secret rather than stored, so it needs no table, is
 * stable across deploys, and every org's key is revoked at once by rotating the
 * secret. Lives outside the route because Next.js route modules may only export
 * request handlers and their config.
 */
export function ingestKeyFor(orgId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.APP_SECRET;
  // Fail closed. Falling back to "" made every org's key an HMAC of the empty
  // string — identical everywhere and computable by anyone who knows the org id,
  // which is exactly the authentication this key is supposed to provide.
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET (or APP_SECRET) must be set — refusing to derive a webhook key from an empty secret");
  }
  return crypto.createHmac("sha256", secret).update(`ingest:${orgId}`).digest("hex").slice(0, 32);
}
