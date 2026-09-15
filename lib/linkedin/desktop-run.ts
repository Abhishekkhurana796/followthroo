import { getRedis } from "../ratelimit";

const TTL_MS = 120_000;

export type DesktopRun = {
  runId: string;
  deviceId: string;
  campaignId: string | null;
  startedAt: string;
};

const keyFor = (accountId: string) => `linkedin:desktop-run:${accountId}`;

export async function currentDesktopRun(accountId: string): Promise<DesktopRun | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(keyFor(accountId));
  if (!raw) return null;
  try { return JSON.parse(raw) as DesktopRun; } catch { return null; }
}

/**
 * One LinkedIn browser session per paired member, across every computer.
 *
 * A lease already held by *this* device is taken over rather than refused. The
 * desktop app is single-instance and refuses a second run while one is going,
 * so a lease from the same deviceId can only belong to a process that crashed
 * or whose release never reached us — and refusing it made "Resume" after a
 * crash fail for two minutes with "already running on another desktop", about
 * the very computer the person was sitting at. One atomic script, so a
 * different device can never slip in between the read and the write.
 */
export async function acquireDesktopRun(accountId: string, run: DesktopRun) {
  const redis = await getRedis();
  if (!redis) return { ok: false as const, unavailable: true as const, current: null };
  const outcome = Number(
    await redis.eval(
      `local v=redis.call('get',KEYS[1]); local took=0; if v then local ok,j=pcall(cjson.decode,v); if not (ok and j.deviceId==ARGV[2]) then return 0 end; took=1 end; redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[3]); return 1+took`,
      1,
      keyFor(accountId),
      JSON.stringify(run),
      run.deviceId,
      String(TTL_MS),
    ),
  );
  if (outcome > 0) return { ok: true as const, ttlMs: TTL_MS, tookOver: outcome === 2 };
  return { ok: false as const, unavailable: false as const, current: await currentDesktopRun(accountId) };
}

export async function renewDesktopRun(accountId: string, runId: string) {
  const redis = await getRedis();
  if (!redis) return false;
  const renewed = await redis.eval(
    `local v=redis.call('get',KEYS[1]); if not v then return 0 end; local ok,j=pcall(cjson.decode,v); if ok and j.runId==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) end; return 0`,
    1,
    keyFor(accountId),
    runId,
    String(TTL_MS),
  );
  return Number(renewed) === 1;
}

export async function releaseDesktopRun(accountId: string, runId: string) {
  const redis = await getRedis();
  if (!redis) return false;
  const removed = await redis.eval(
    `local v=redis.call('get',KEYS[1]); if not v then return 0 end; local ok,j=pcall(cjson.decode,v); if ok and j.runId==ARGV[1] then return redis.call('del',KEYS[1]) end; return 0`,
    1,
    keyFor(accountId),
    runId,
  );
  return Number(removed) === 1;
}

export const DESKTOP_RUN_TTL_MS = TTL_MS;
