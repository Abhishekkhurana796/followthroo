/**
 * Rate limits on our own API — requests coming in, not messages going out.
 *
 * lib/ratelimit.ts guards what the product sends (per-channel quotas). Nothing
 * guarded what it receives: an extension token could call lookup in a loop, a
 * leaked webhook key could flood the lead table, and a CSV import could be fired
 * as fast as a script can post. Sign-in is covered separately, by better-auth's
 * own limiter (lib/auth.ts).
 *
 * Fixed-window counters in Redis — INCR, then EXPIRE on the first hit — shared by
 * every Vercel instance. Two rules keep it from becoming the outage it guards
 * against:
 *
 *   - it fails OPEN. Redis slow or down means requests are allowed, not refused:
 *     a limiter that takes the API down with it has swapped one incident for a
 *     worse one. The client in lib/ratelimit.ts retries forever, so every call
 *     here is raced against a short timeout.
 *   - without Redis it falls back to a per-instance counter, and says so once in
 *     production, because that is barely a limit at all.
 */
import { NextResponse } from "next/server";
import { getRedis } from "./ratelimit";

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

/** Every limit in one place, so they can be read and tuned together. */
export const LIMITS = {
  /** Extension and desktop calls, per pairing token. A page render makes one or two. */
  extension: { max: 120, windowSec: 60 },
  /** Inbound webhooks, per source and key. Lead forms rarely burst past this. */
  webhook: { max: 300, windowSec: 60 },
  /** CSV imports and bulk edits, per member. Heavy writes nobody needs many of. */
  heavyWrite: { max: 20, windowSec: 60 },
  /** Open and click tracking, per IP. Mail scanners fetch a lot; this only stops floods. */
  tracking: { max: 600, windowSec: 60 },
} satisfies Record<string, Limit>;

const REDIS_TIMEOUT_MS = 250;
const memory = new Map<string, { count: number; expiresAt: number }>();
let warnedNoRedis = false;

function timeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("rate limit store timed out")), ms));
}

/** Count one request against `key`. Never throws. */
export async function hit(key: string, limit: Limit): Promise<{ ok: boolean; retryAfterSec: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSec / limit.windowSec);
  const bucket = `api-rl:${key}:${window}`;
  const retryAfterSec = limit.windowSec - (nowSec % limit.windowSec);

  try {
    const redis = await Promise.race([getRedis(), timeout<null>(REDIS_TIMEOUT_MS)]);
    if (redis) {
      const count = await Promise.race([redis.incr(bucket), timeout<number>(REDIS_TIMEOUT_MS)]);
      if (count === 1) redis.expire(bucket, limit.windowSec).catch(() => {});
      return { ok: count <= limit.max, retryAfterSec };
    }
  } catch (e) {
    console.warn("[api-ratelimit] store unavailable, allowing request:", (e as Error).message);
    return { ok: true, retryAfterSec: 0 };
  }

  if (!warnedNoRedis && process.env.NODE_ENV === "production") {
    warnedNoRedis = true;
    console.warn("[api-ratelimit] REDIS_URL is not set — API limits are per instance and barely effective.");
  }
  const now = Date.now();
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
  }
  const cur = memory.get(bucket);
  const count = cur && cur.expiresAt > now ? cur.count + 1 : 1;
  memory.set(bucket, { count, expiresAt: cur && cur.expiresAt > now ? cur.expiresAt : now + limit.windowSec * 1000 });
  return { ok: count <= limit.max, retryAfterSec };
}

/** A 429 with Retry-After when `key` is over its limit, otherwise null. */
export async function tooMany(key: string, limit: Limit): Promise<NextResponse | null> {
  const r = await hit(key, limit);
  if (r.ok) return null;
  return NextResponse.json(
    { ok: false, error: `Too many requests. Try again in ${r.retryAfterSec} seconds.` },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

/** The caller's address as Vercel reports it — for limits with no account to key on. */
export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

type AuthRateLimitRecord = { key: string; count: number; lastRequest: number };

/**
 * Where better-auth keeps its sign-in and sign-up counts (lib/auth.ts).
 *
 * Its default is memory, which on Vercel means per instance: a script spreading
 * sign-in attempts across instances would barely register. The same Redis as the
 * limits above, under the same two rules — short timeouts, and fail open.
 */
export const authRateLimitStorage = {
  async get(key: string): Promise<AuthRateLimitRecord | null> {
    try {
      const redis = await Promise.race([getRedis(), timeout<null>(REDIS_TIMEOUT_MS)]);
      if (!redis) return null;
      const raw = await Promise.race([redis.get(`auth-rl:${key}`), timeout<string | null>(REDIS_TIMEOUT_MS)]);
      return raw ? (JSON.parse(raw) as AuthRateLimitRecord) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: AuthRateLimitRecord): Promise<void> {
    try {
      const redis = await Promise.race([getRedis(), timeout<null>(REDIS_TIMEOUT_MS)]);
      if (!redis) return;
      await Promise.race([redis.set(`auth-rl:${key}`, JSON.stringify(value), "EX", 60 * 60), timeout(REDIS_TIMEOUT_MS)]);
    } catch {
      // Fail open: a missed count is better than a sign-in page that hangs.
    }
  },
};
