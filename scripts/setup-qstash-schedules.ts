/**
 * QStash Schedules — the scheduler.
 *
 * Vercel Cron via vercel.json was tried and removed: Hobby plans reject any cron
 * expression that runs more than once a day, at deploy time, and this app needs
 * a 5-minute reply poller. QStash has no such limit, costs nothing extra here,
 * and its signature verification is already wired (lib/cron-auth.ts).
 *
 * This does NOT run itself. Nothing is scheduled until someone runs it against
 * production, and a fresh environment therefore has no reply polling, no
 * warm-up, no sweeps and no task reminders until they do.
 *
 * Usage (PowerShell):
 *   $env:APP_URL="https://app.followthroo.com"; npx tsx scripts/setup-qstash-schedules.ts
 * Usage (bash):
 *   APP_URL=https://app.followthroo.com npx tsx scripts/setup-qstash-schedules.ts
 *
 * Requires QSTASH_TOKEN in the environment — this script does not read
 * .env.local, so export it in the shell first. APP_URL must match
 * NEXT_PUBLIC_APP_URL exactly: signature verification checks the destination
 * URL, and a mismatch 401s silently, forever.
 *
 * Idempotent: it deletes any existing schedules pointing at these endpoints
 * before recreating them, so re-running after adding a job is safe.
 *
 * If the project ever moves to a Vercel Pro plan, vercel.json crons become
 * viable again (100 jobs, per-minute precision) and would remove this manual
 * step — see docs/ARCHITECTURE.md.
 */
const QSTASH_URL = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
const TOKEN = process.env.QSTASH_TOKEN;
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

const SCHEDULES = [
  { path: "/api/inbox/poll", cron: "*/5 * * * *", label: "reply-poller (every 5 min)" },
  { path: "/api/warmup/run", cron: "0 */4 * * *", label: "warm-up (every 4 h)" },
  { path: "/api/cron/sla-sweep", cron: "*/15 * * * *", label: "SLA sweep (every 15 min)" },
  { path: "/api/cron/enrollment-sweep", cron: "*/10 * * * *", label: "enrollment sweep (every 10 min)" },
  { path: "/api/cron/domain-sweep", cron: "*/5 * * * *", label: "domain + DNS sweep (every 5 min)" },
  { path: "/api/cron/task-sweep", cron: "*/15 * * * *", label: "task reminders + escalation (every 15 min)" },
  // Hourly, not daily: the handler picks the orgs whose LOCAL clock just hit 8am.
  { path: "/api/cron/daily-digest", cron: "0 * * * *", label: "morning task digest (hourly, sends at local 8am)" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function main() {
  if (!TOKEN) throw new Error("QSTASH_TOKEN is not set");
  if (!APP_URL || APP_URL.includes("localhost")) throw new Error(`APP_URL must be your public prod URL, got: "${APP_URL}"`);
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const destUrls = SCHEDULES.map((s) => `${APP_URL}${s.path}`);

  // Remove any existing schedules for our endpoints (idempotent re-run).
  const listRes = await fetch(`${QSTASH_URL}/v2/schedules`, { headers: auth });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing: any[] = listRes.ok ? await listRes.json().catch(() => []) : [];
  for (const sch of Array.isArray(existing) ? existing : []) {
    const dest = sch.destination || sch.url || "";
    if (destUrls.some((u) => dest === u)) {
      await fetch(`${QSTASH_URL}/v2/schedules/${sch.scheduleId}`, { method: "DELETE", headers: auth });
      console.log(`- deleted old schedule ${sch.scheduleId} → ${dest}`);
    }
  }

  for (const s of SCHEDULES) {
    const dest = `${APP_URL}${s.path}`;
    const res = await fetch(`${QSTASH_URL}/v2/schedules/${dest}`, {
      method: "POST",
      headers: { ...auth, "Upstash-Cron": s.cron, "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`FAILED to create ${s.label}: ${res.status} ${JSON.stringify(j)}`);
      process.exit(1);
    }
    console.log(`+ ${s.label}: schedule ${j.scheduleId} → ${dest}`);
  }
  console.log("\nDone. QStash now drives reply polling + warm-up (no Vercel cron needed).");
}

main().catch((e) => { console.error(e); process.exit(1); });
