/** Browser-level contract for the local full-page Electron renderer. */
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

let passed = 0, failed = 0;
const ok = (condition: boolean, message: string) => {
  if (condition) { passed++; console.log("  ok  ", message); }
  else { failed++; console.log("  FAIL", message); }
};

async function main() {
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
  page.on("console", (message) => console.log("  renderer:", message.text()));
  page.on("pageerror", (error) => console.log("  renderer error:", error.message));
  await page.addInitScript({ content: `
    window.__test = { starts: [], collapsed: false, event: function () {} };
    window.ft = {
      getSettings: async function () { return { version: "1.15.0", maxPerDay: 20, sentToday: 4, running: false, runningMode: null, apiBase: "https://app.followthroo.com", token: "paired" }; },
      peekQueue: async function () { return { ok: true, people: [{ id: "i1", leadName: "Ada Lovelace", linkedinUrl: "https://linkedin.com/in/ada", type: "invite", noteChoice: "no" }], held: [], notes: { left: 2, cap: 3, exhaustedByLinkedIn: false }, pacing: { minDelaySec: 45, maxDelaySec: 90 }, autoSend: true }; },
      peekEnrichment: async function () { return { ok: true, queued: 1, daily: { used: 12, cap: 150, remaining: 138 }, people: [{ id: "e1", leadName: "Grace Hopper", linkedinUrl: "https://linkedin.com/in/grace", source: "manual", attempts: 0 }] }; },
      authStatus: async function () { return { signedIn: true }; },
      setNote: async function () { return { ok: true }; },
      saveSettings: async function () { return { ok: true, settings: { apiBase: "https://app.followthroo.com" } }; },
      start: async function (options) { window.__test.starts.push(options); return { ok: true }; },
      stop: async function () { return { ok: true }; }, signIn: async function () { return { ok: true }; },
      togglePanel: async function (collapsed) { window.__test.collapsed = collapsed; return { collapsed: collapsed }; },
      onEvent: function (handler) { window.__test.event = handler; }, onUpdate: function () {}, installUpdate: async function () { return { ok: true }; }
    };
  ` });
  await page.goto(pathToFileURL(join(process.cwd(), "desktop", "renderer", "index.html")).href);
  await page.waitForFunction(() => document.querySelector("#inviteCount")?.textContent === "1" && document.querySelector("#enrichCount")?.textContent === "1");

  ok(await page.getByRole("heading", { name: "Send connections" }).isVisible(), "the invitation lane is a full-page card");
  ok(await page.getByRole("heading", { name: "Profile enrichment" }).isVisible(), "the enrichment lane is a separate full-page card");
  ok((await page.locator("#inviteStart").textContent())?.includes("1 connection") === true, "the invite button counts only invitations");
  ok((await page.locator("#enrichStart").textContent())?.includes("1 profiles") === true, "the enrichment button counts only lookups");

  await page.locator("#inviteStart").click();
  await page.evaluate(() => (window as unknown as { __test: { event: (event: Record<string, unknown>) => void } }).__test.event({ type: "idle", lane: "invite" }));
  await page.locator("#enrichStart").click();
  const starts = await page.evaluate(() => (window as unknown as { __test: { starts: Array<Record<string, unknown>> } }).__test.starts);
  ok(starts[0]?.mode === "invite" && starts[1]?.mode === "enrich", "each button starts only its own lane");

  await page.locator("#webSwitch").click();
  ok(await page.locator("body").evaluate((body) => body.classList.contains("collapsed")), "Web app leaves the trusted Automation rail visible");
  await page.locator("#reopen").click();
  ok(!(await page.locator("body").evaluate((body) => body.classList.contains("collapsed"))), "the left arrow returns to Automation");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
