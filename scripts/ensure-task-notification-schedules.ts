export {};

/**
 * Creates only the missing task notification schedules. Unlike the full scheduler
 * setup tool, it never deletes or changes any existing production schedule.
 */
const token = process.env.QSTASH_TOKEN;
const rawBase = (process.env.QSTASH_URL || "https://qstash.upstash.io").trim().replace(/\/$/, "");
const base = rawBase.startsWith("https://") ? rawBase : "https://qstash.upstash.io";
const appUrl = (process.env.APP_URL || "https://app.followthroo.com").replace(/\/$/, "");
const required = [
  { path: "/api/cron/task-sweep", cron: "*/15 * * * *" },
  { path: "/api/cron/daily-digest", cron: "0 * * * *" },
];

async function main() {
  if (!token) throw new Error("QSTASH_TOKEN is not set");
  if (!appUrl || appUrl.includes("localhost")) throw new Error("APP_URL must be the public application URL");
  const auth = { Authorization: `Bearer ${token}` };
  const listed = await fetch(`${base}/v2/schedules`, { headers: auth });
  if (!listed.ok) throw new Error(`QStash schedule list failed (${listed.status})`);
  const schedules: { destination?: string; url?: string }[] = await listed.json();
  const destinations = new Set(schedules.map((schedule) => schedule.destination || schedule.url));

  for (const job of required) {
    const destination = `${appUrl}${job.path}`;
    if (destinations.has(destination)) {
      console.log(`already scheduled: ${job.path}`);
      continue;
    }
    const created = await fetch(`${base}/v2/schedules/${destination}`, {
      method: "POST",
      headers: { ...auth, "Upstash-Cron": job.cron, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!created.ok) throw new Error(`Could not create ${job.path} (${created.status})`);
    console.log(`created: ${job.path}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
