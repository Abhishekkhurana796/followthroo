/**
 * The desktop run lease: one LinkedIn browser session per paired member.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/verify-desktop-run-lease.ts
 *
 * Uses the real Redis (the lease is a Lua script, so a mock would test nothing)
 * under a throwaway account id that is deleted at the end. Touches no database.
 */
import { randomUUID } from "node:crypto";
import { acquireDesktopRun, currentDesktopRun, releaseDesktopRun, renewDesktopRun } from "../lib/linkedin/desktop-run";
import { getRedis } from "../lib/ratelimit";

let pass = 0;
let fail = 0;
const ok = (condition: boolean, message: string, extra = "") => {
  if (condition) pass++;
  else fail++;
  console.log(condition ? "  ok  " : "  FAIL", message, extra);
};

const run = (deviceId: string) => ({ runId: randomUUID(), deviceId, campaignId: "campaign-1", startedAt: new Date().toISOString() });

async function main() {
  const redis = await getRedis();
  if (!redis) {
    console.log("REDIS_URL is not set — the lease refuses every run without it, which is itself the intended behaviour.");
    process.exit(1);
  }
  const account = `verify-lease-${Date.now()}`;
  const laptopRun = run("laptop-aaaa-1111");
  const desktopRun = run("desktop-bbbb-2222");

  try {
    const first = await acquireDesktopRun(account, laptopRun);
    ok(first.ok === true, "the first computer gets the run");
    ok(first.ok === true && first.tookOver === false, "...as a fresh lease, not a takeover");

    const second = await acquireDesktopRun(account, desktopRun);
    ok(second.ok === false, "a second computer is refused while the first holds it");
    ok(!second.ok && second.current?.runId === laptopRun.runId, "...and is told which run holds it");

    ok(await renewDesktopRun(account, laptopRun.runId), "the owner can renew its lease");
    ok(!(await renewDesktopRun(account, desktopRun.runId)), "a non-owner cannot renew someone else's lease");

    // The laptop crashes mid-campaign and is reopened: a new process, a new
    // runId, the same deviceId. It must not be locked out of its own run.
    const afterCrash = run(laptopRun.deviceId);
    const reclaimed = await acquireDesktopRun(account, afterCrash);
    ok(reclaimed.ok === true, "the same computer can resume straight after a crash");
    ok(reclaimed.ok === true && reclaimed.tookOver === true, "...by taking over its own stale lease");
    ok((await currentDesktopRun(account))?.runId === afterCrash.runId, "...which now belongs to the new process");
    ok(!(await renewDesktopRun(account, laptopRun.runId)), "the crashed process's runId can no longer renew");
    ok(!(await releaseDesktopRun(account, laptopRun.runId)), "...or release the new owner's lease");

    const stillRefused = await acquireDesktopRun(account, run(desktopRun.deviceId));
    ok(stillRefused.ok === false, "a takeover never extends to a different computer");

    ok(await releaseDesktopRun(account, afterCrash.runId), "the owner releases when it finishes");
    ok((await currentDesktopRun(account)) === null, "...leaving no lease behind");
    const now = await acquireDesktopRun(account, desktopRun);
    ok(now.ok === true, "another computer can start once it is released");
  } finally {
    await redis.del(`linkedin:desktop-run:${account}`);
    console.log(`\n${pass} passed, ${fail} failed`);
    await redis.quit().catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
