export {};

/** Read-only production scheduler health check. It never prints credentials. */
const token = process.env.QSTASH_TOKEN;
const rawBase = (process.env.QSTASH_URL || "https://qstash.upstash.io").trim().replace(/\/$/, "");
const base = rawBase.startsWith("https://") ? rawBase : "https://qstash.upstash.io";
// Schedules target the authenticated app host, not the public marketing host.
const appUrl = (process.env.APP_URL || "https://app.followthroo.com").replace(/\/$/, "");
const required = ["/api/cron/task-sweep", "/api/cron/daily-digest"];

async function main() {
  if (!token) throw new Error("QSTASH_TOKEN is not set");
  const response = await fetch(`${base}/v2/schedules`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`QStash schedule list failed (${response.status})`);
  const schedules: { destination?: string; url?: string }[] = await response.json();
  const destinations = new Set(schedules.map((schedule) => schedule.destination || schedule.url));
  const missing = required.filter((path) => !destinations.has(`${appUrl}${path}`));
  console.log(JSON.stringify({ checked: required, missing, healthy: missing.length === 0 }));
  if (missing.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
