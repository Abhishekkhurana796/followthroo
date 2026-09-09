/**
 * Followthroo LinkedIn Assistant — background service worker.
 *
 * Sourcing only. On a paced alarm it claims a scrape job, opens the page it names in a
 * BACKGROUND tab, reads the rows already rendered there, and reports them. Nothing is
 * clicked, submitted or sent.
 *
 * Invitations and messages used to live here too, as a draft-then-confirm handshake. They
 * now belong to the desktop app, which drives a real browser with Playwright and can
 * actually click Send. Two clients polling one queue would each claim the same action and
 * each act on it, so this one no longer asks for actions at all — see pollOnce.
 *
 * Every step logs to the service-worker console AND stores `lastStatus` (shown in the
 * popup) so "nothing happened" always has a visible reason.
 */
const POLL_ALARM = "ft-linkedin-poll";

function cfg() {
  return new Promise((r) =>
    chrome.storage.local.get(["apiBase", "token", "enabled", "nextRunAt"], r),
  );
}
function setStatus(msg, isError) {
  console.log(`[followthroo] ${msg}`);
  chrome.storage.local.set({ lastStatus: msg, lastStatusAt: Date.now(), lastStatusError: !!isError });
}
/**
 * When the next poll may happen.
 *
 * This used to be a one-shot alarm — `chrome.alarms.create(name, { when })` —
 * which meant the timer only survived if pollOnce ran all the way to the bottom
 * and armed the next one. Three early returns did not (paused, not configured,
 * and a draft awaiting review), so hitting any of them killed the extension
 * silently and permanently: no alarm, no polling, no error, until Chrome
 * restarted. A stuck draft took it down for forty minutes and looked exactly
 * like "auto-send does not work".
 *
 * Now the alarm is a periodic heartbeat that nothing can lose, and pacing is a
 * timestamp the heartbeat checks. Losing a beat costs one minute; it cannot cost
 * the whole session.
 */
const HEARTBEAT_MINUTES = 1;

function ensureHeartbeat() {
  chrome.alarms.get(POLL_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(POLL_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
  });
}

/** Hold off until `sec` from now. The heartbeat keeps beating regardless. */
function schedule(sec) {
  const at = Date.now() + Math.max(30, Math.round(sec)) * 1000;
  chrome.storage.local.set({ nextRunAt: at });
  ensureHeartbeat();
}
function waitForTab(tabId) {
  return new Promise((resolve) => {
    const to = setTimeout(finish, 25000);
    function finish() { clearTimeout(to); chrome.tabs.onUpdated.removeListener(l); setTimeout(resolve, 1800); }
    function l(id, info) { if (id === tabId && info.status === "complete") finish(); }
    chrome.tabs.onUpdated.addListener(l);
  });
}

/* ------------------------------------------------------------------ */
/* Scraping — reading pages the rep is already allowed to see           */
/* ------------------------------------------------------------------ */

/**
 * Claim one scrape job and read the page it names.
 *
 * Opens in a BACKGROUND tab, unlike the draft flow: nothing here needs the
 * person's attention or their click, so stealing focus would be rude. Nothing is
 * clicked, submitted or sent — the reader functions in scrapers.js only read
 * what is already rendered.
 *
 * Returns "ran" | "idle" | "paused".
 */
async function runScrapeJob(apiBase, token) {
  let job, pausedUntil;
  try {
    const res = await fetch(`${apiBase}/api/linkedin/scrape/claim`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) return "idle";
    job = j.data.job;
    pausedUntil = j.data.pausedUntil;
  } catch {
    return "idle";
  }

  if (!job) {
    if (pausedUntil) {
      setStatus(`daily reading limit reached — resumes ${new Date(pausedUntil).toLocaleTimeString()}`);
      return "paused";
    }
    return "idle";
  }

  const label = `Reading ${job.kind.replace(/_/g, " ")}…`;
  setStatus(label.toLowerCase());
  await chrome.storage.local.set({ reading: { active: true, label, found: 0, target: job.maxResults } });
  let tab;
  try {
    tab = await chrome.tabs.create({ url: job.url, active: false });
    await waitForTab(tab.id);

    // Scroll to pull in lazily-rendered rows, then read. Paced like a person
    // skimming rather than a script racing to the bottom.
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["scrapers.js"],
    });
    void res;

    // Scroll in short bursts rather than one long loop, so progress can be
    // reported between them. A scrape of a thousand rows takes minutes, and
    // silence for minutes is indistinguishable from being broken.
    let result = { failureKind: "error", error: "no result from page" };
    let stalled = 0;
    for (let pass = 0; pass < 20; pass++) {
      const [out] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (kind, maxResults) => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const count = () => (window.__ftScrape ? (window.__ftScrape(kind).rows || []).length : 0);
          const before = count();
          for (let i = 0; i < 3 && count() < maxResults; i++) {
            window.scrollBy(0, window.innerHeight * 0.9);
            // Paced like a person skimming, not a script racing to the bottom.
            await sleep(700 + Math.random() * 900);
          }
          const r = window.__ftScrape ? window.__ftScrape(kind) : { failureKind: "error", error: "reader missing" };
          return { ...r, before, after: count() };
        },
        args: [job.kind, job.maxResults],
      });

      result = (out && out.result) || result;
      const found = (result.rows || []).length;
      await chrome.storage.local.set({ reading: { active: true, label, found, target: job.maxResults } });

      // Heartbeat, so the dashboard shows movement too. Best-effort by design:
      // a dropped progress ping must never fail the scrape it was describing.
      fetch(`${apiBase}/api/linkedin/scrape/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, progress: found }),
      }).catch(() => {});

      if (found >= job.maxResults) break;
      // Two passes with nothing new means the page has stopped loading rows.
      stalled = result.after === result.before ? stalled + 1 : 0;
      if (stalled >= 2) break;
    }

    if (result.rows) result.rows = result.rows.slice(0, job.maxResults);
    await fetch(`${apiBase}/api/linkedin/scrape/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, done: true, ...result }),
    });

    const n = (result.rows || []).length;
    setStatus(
      result.failureKind === "selector_miss"
        ? "could not read that page — LinkedIn changed its layout"
        : `read ${n} row${n === 1 ? "" : "s"}`,
      result.failureKind === "selector_miss",
    );
  } catch (e) {
    await fetch(`${apiBase}/api/linkedin/scrape/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, done: true, failureKind: "error", error: String((e && e.message) || e) }),
    }).catch(() => {});
    setStatus(`scrape failed: ${String((e && e.message) || e)}`, true);
  } finally {
    await chrome.storage.local.set({ reading: null });
    if (tab && tab.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
  return "ran";
}

async function pollOnce() {
  const { apiBase, token, enabled, nextRunAt } = await cfg();

  // The heartbeat fires every minute regardless of pacing; this is what spaces
  // out scrape jobs. Returning here is free and, unlike the old one-shot alarm,
  // returning early can no longer strand the extension.
  if (nextRunAt && Date.now() < nextRunAt) return;

  if (!enabled) return setStatus("paused — press Start in the popup");
  if (!token || !apiBase) return setStatus("not configured — set App URL + token, then Save", true);

  // Guard the most common misconfig: the wrong host has no queue endpoint behind it.
  // localhost is an optional_host_permission (the Web Store rightly questions a
  // published extension that can reach your machine), so it has to be granted at
  // runtime the first time a developer points at a local server.
  if (/^https?:\/\/(localhost|127\.0\.0\.1):3000/i.test(apiBase)) {
    const granted = await chrome.permissions.contains({ origins: ["http://localhost:3000/*"] });
    if (!granted) {
      return setStatus("local development: open Settings and press Allow to grant access to localhost", true);
    }
  }

  if (!/^https?:\/\/(app\.followthroo\.com|localhost:3000|127\.0\.0\.1:3000)/i.test(apiBase)) {
    return setStatus('App URL should be "https://app.followthroo.com" (the product lives there, not on the marketing site)', true);
  }

  // Scrape jobs come first. They are pure reading — no invite, no message, no
  // click — so they are both safer and usually what the person is waiting on.
  const scraped = await runScrapeJob(apiBase, token);
  if (scraped === "ran") return schedule(20);
  if (scraped === "paused") return schedule(900);

  // Sourcing is now the whole job. Invitations and messages moved to the
  // desktop app, which drives a real browser with Playwright.
  //
  // The queue must have exactly one claimer. Both clients poll
  // /api/linkedin/queue with the same token, and claimActions marks a row
  // in_progress with a read followed by a write — so two pollers landing
  // together can each come away holding the same action and each send it. A
  // duplicate invitation cannot be recalled, which makes "probably fine, the
  // window is small" the wrong risk to carry.
  //
  // Nothing here needs the server's permission to stop: not asking for actions
  // is the whole mechanism.
  schedule(75);
  setStatus("connected — watching for lead sourcing jobs (invitations are sent by the desktop app)");
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === POLL_ALARM) pollOnce(); });
chrome.runtime.onInstalled.addListener(() => { setStatus("installed"); schedule(5); });
chrome.runtime.onStartup.addListener(() => schedule(5));

// The service worker is torn down when idle and revived by events. Re-arming on
// every revival is what guarantees a heartbeat exists even if one was somehow
// lost — the alarm is created only when absent, so this cannot stack them.
ensureHeartbeat();
chrome.storage.onChanged.addListener((ch) => { if (ch.enabled && ch.enabled.newValue) { setStatus("started"); schedule(3); } });
