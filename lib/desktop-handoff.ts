/**
 * Handing a signed-in session from the system browser to the desktop app.
 *
 * Google refuses OAuth in embedded browsers — Electron included — so the desktop
 * app cannot show Google's own sign-in page. The way round it is to sign in
 * where Google is happy, in the real browser, and then pass the resulting
 * session back.
 *
 * What gets passed is a short-lived, single-use code, never the session token
 * itself. The code travels through a `followthroo://` URL, which means it lands
 * in the OS's protocol handler, shell history and possibly a log; a session
 * token there would be a durable credential sitting in all three. A code that
 * dies on first use, sixty seconds after it was minted, is worth far less to
 * anyone who finds it.
 *
 * Stored in Redis with a TTL rather than a table, so there is no migration and
 * nothing to clean up. Without Redis this is unavailable rather than
 * memory-backed: a code that only works when the exchange happens to hit the
 * same serverless instance would fail unpredictably, and "sign-in sometimes
 * works" is worse than "this deployment doesn't support it".
 */
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { env, configured } from "./env";

type Redis = import("ioredis").Redis;
let redis: Redis | null = null;

async function getRedis(): Promise<Redis | null> {
  if (!configured.redis) return null;
  if (redis) return redis;
  const { default: IORedis } = await import("ioredis");
  redis = new IORedis(env.redisUrl!, { maxRetriesPerRequest: null });
  return redis;
}

/** Long enough that a run to the browser and back is comfortable, short enough to be worthless if leaked. */
const TTL_SECONDS = 120;

/** Stored hashed, so a dump of Redis is not a pile of usable codes. */
const keyFor = (code: string) => `desktop-handoff:${createHash("sha256").update(code).digest("hex")}`;

export const handoffAvailable = () => configured.redis;

/**
 * Mint a one-time code for an already-authenticated session.
 * Returns null when Redis is not configured.
 */
export async function createHandoffCode(sessionToken: string): Promise<string | null> {
  const r = await getRedis();
  if (!r) return null;
  const code = randomBytes(32).toString("base64url");
  await r.set(keyFor(code), sessionToken, "EX", TTL_SECONDS);
  return code;
}

/**
 * Redeem a code, exactly once.
 *
 * `GETDEL` is what makes "once" true — a get followed by a delete leaves a
 * window in which two exchanges both succeed, and this is the one place where
 * that would hand a second party a live session.
 */
export async function redeemHandoffCode(code: string): Promise<string | null> {
  const r = await getRedis();
  if (!r) return null;
  if (!code || code.length < 20 || code.length > 200) return null;
  const token = await r.getdel(keyFor(code));
  return token || null;
}

/** Constant-time compare, for callers checking a code they already hold. */
export function sameCode(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
