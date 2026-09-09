/**
 * Rate limiting — mirrors docs/rate-limits.md.
 * Rolling-window counters per (channel, account) with jitter + safety stops.
 *
 * Uses Redis when REDIS_URL is set; otherwise an in-memory fallback (single-instance
 * dev). Production MUST use Redis so counters are shared across workers.
 */
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

// In-memory fallback: key → array of timestamps (ms)
const memory = new Map<string, number[]>();

function windowMsForChannel(channel: string): number {
  // email limit is per-hour; others are per-day
  return channel === "email" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export function limitForChannel(channel: string): number {
  switch (channel) {
    case "email":
      return env.limits.emailPerHour;
    case "linkedin":
      return env.limits.linkedinPerDay;
    case "whatsapp":
      return env.limits.whatsappPerDay;
    default:
      return 60; // social / misc: conservative default per day
  }
}

export interface Quota {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Try to consume one unit of quota for (channel, account).
 * Returns { ok, remaining, retryAfterMs }.
 */
export async function acquire(
  channel: string,
  account = "default",
  orgId = "global"
): Promise<Quota> {
  const limit = limitForChannel(channel);
  const windowMs = windowMsForChannel(channel);
  const now = Date.now();
  const key = `rl:${orgId}:${channel}:${account}`;

  const r = await getRedis();
  if (r) {
    // Sorted-set sliding window
    const cutoff = now - windowMs;
    await r.zremrangebyscore(key, 0, cutoff);
    const count = await r.zcard(key);
    if (count >= limit) {
      const oldest = await r.zrange(key, 0, 0, "WITHSCORES");
      const retryAfterMs = oldest.length ? Number(oldest[1]) + windowMs - now : windowMs;
      return { ok: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
    }
    await r.zadd(key, now, `${now}-${Math.random()}`);
    await r.pexpire(key, windowMs);
    return { ok: true, remaining: limit - count - 1, retryAfterMs: 0 };
  }

  // In-memory fallback
  const arr = (memory.get(key) ?? []).filter((t) => t > now - windowMs);
  if (arr.length >= limit) {
    const retryAfterMs = arr[0] + windowMs - now;
    memory.set(key, arr);
    return { ok: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
  }
  arr.push(now);
  memory.set(key, arr);
  return { ok: true, remaining: limit - arr.length, retryAfterMs: 0 };
}

/** Humanizing delay between actions: base ± jitter. Default 30–90s. */
export function jitterMs(minMs = 30_000, maxMs = 90_000): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

