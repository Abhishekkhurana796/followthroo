/**
 * Followthroo LinkedIn Assistant — background service worker.
 *
 * On a paced alarm it: polls the app for ONE queued action, opens the target profile in a
 * FOREGROUNDED tab, fills the invite note / message box via an injected script, and STOPS —
 * it never clicks Send. A real person reviews what was filled and sends it themselves inside
 * their own LinkedIn tab, then confirms (or skips) from the popup. That confirmation is what
 * reports the outcome back to the app; nothing here acts autonomously past the draft.
 *
 * While a draft is awaiting review, polling pauses (one action in flight at a time — no
 * stacking foregrounded tabs). It resumes once the popup reports sent/skipped.
 *
 * Every step logs to the service-worker console AND stores `lastStatus` (shown in the
 * popup) so "nothing happened" always has a visible reason.
 */
const POLL_ALARM = "ft-linkedin-poll";

/**
 * How long an unreviewed draft may hold up the queue.
 *
 * Matches DRAFT_STALE_MS in lib/linkedin/queue.ts, which is what the server uses
 * to reclaim a `drafted` row. If the two disagree, one side releases the action
 * while the other still thinks it is held, and the queue stalls again.
 */
const DRAFT_STALE_MS = 40 * 60 * 1000;

function cfg() {
  return new Promise((r) =>
    chrome.storage.local.get(
      // autoSendKnown is the last value the server told us. The draft check runs
      // before we have a fresh action to read it from, so it has to be remembered.
      ["apiBase", "token", "enabled", "stats", "draft", "nextRunAt", "autoSendKnown"],
      r,
    ),
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

/** Opens the profile FOREGROUNDED and fills the note/message box. Never clicks Send. */
async function draftAction(action) {
  let tab;
  try {
    setStatus(`opening ${action.linkedinUrl} for review`);
    tab = await chrome.tabs.create({ url: action.linkedinUrl, active: true });
    await waitForTab(tab.id);
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillLinkedInAction,
      args: [action],
    });
    const outcome = res?.result || { status: "failed", result: "no result from page" };
    return { ...outcome, tabId: tab.id };
  } catch (e) {
    return { status: "failed", result: String((e && e.message) || e), tabId: tab && tab.id };
  }
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
  const { apiBase, token, enabled, stats, draft, nextRunAt, autoSendKnown } = await cfg();

  // The heartbeat fires every minute regardless of pacing; this is what keeps
  // the 45–120s gap between actions. Returning here is free and, unlike the old
  // one-shot alarm, returning early can no longer strand the extension.
  if (nextRunAt && Date.now() < nextRunAt) return;

  if (!enabled) return setStatus("paused — press Start in the popup");
  if (!token || !apiBase) return setStatus("not configured — set App URL + token, then Save", true);

  // A draft is already awaiting human review — don't open another tab on top of it.
  //
  // But it must not wait forever. This used to be an unconditional return, so a
  // single draft nobody confirmed wedged the queue permanently: 58 invites sat
  // behind one tab that had been closed days earlier, and nothing on any screen
  // said so. The server already reclaims a stale `drafted` row after
  // DRAFT_STALE_MS; the extension now lets go on the same schedule.
  if (draft) {
    // A draft is a manual-mode artefact. If automatic sending is on it is a
    // leftover from before the switch was flipped, and keeping it would block
    // the queue while the popup told the person to go and click Send by hand —
    // which is exactly what they turned the switch on to stop doing.
    if (autoSendKnown === true) {
      await chrome.storage.local.remove("draft");
      setStatus("cleared a leftover draft — sending automatically now");
    } else if (Date.now() - (draft.at || 0) < DRAFT_STALE_MS) {
      return setStatus("awaiting your review — open the popup to confirm or skip");
    } else {
      await chrome.storage.local.remove("draft");
      setStatus("a draft went unreviewed for 40 minutes — released it and carrying on");
    }
  }

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

  setStatus("polling for queued actions…");
  let data;
  try {
    const res = await fetch(`${apiBase}/api/linkedin/queue?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) return schedule(180), setStatus("token rejected (401) — copy a fresh token from Settings → LinkedIn", true);
    if (!res.ok || !j.ok) return schedule(180), setStatus(`server error ${res.status} — ${j.error || "unexpected response"}`, true);
    data = j.data;
  } catch (e) {
    schedule(180);
    return setStatus(`can't reach ${apiBase} (${String((e && e.message) || e)})`, true);
  }

  const pacing = data.pacing || { minDelaySec: 45, maxDelaySec: 120 };
  const action = (data.actions || [])[0];
  if (!action) {
    schedule(75);
    return setStatus("connected — queue is empty (add a LinkedIn campaign step + leads with a LinkedIn URL)");
  }

  // Remember what the server said, so the draft check on the next poll knows
  // whether a stored draft is still meaningful.
  await chrome.storage.local.set({ autoSendKnown: action.autoSend === true });

  const outcome = await draftAction(action);

  // With auto-send on there is no human step, so the draft/confirm handshake
  // must not be entered at all — a "drafted" result there would pause polling
  // waiting for a confirmation nobody is ever asked for.
  if (outcome.status === "drafted" && action.autoSend === true) {
    if (outcome.tabId) chrome.tabs.remove(outcome.tabId).catch(() => {});
    outcome.status = "failed";
    outcome.result = "auto-send is on but the action only got as far as a draft — " + (outcome.result || "no reason given");
  }

  if (outcome.status === "drafted") {
    await chrome.storage.local.set({
      draft: {
        actionId: action.id,
        tabId: outcome.tabId,
        kind: outcome.kind,
        note: action.note,
        linkedinUrl: action.linkedinUrl,
        leadName: action.leadName || null,
        // When it was raised, so an unreviewed draft can be released rather than
        // blocking every action behind it indefinitely.
        at: Date.now(),
      },
    });
    try {
      await fetch(`${apiBase}/api/linkedin/queue`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id, status: "drafted" }),
      });
    } catch { /* best-effort — the server's own stale-reclaim covers a missed update */ }
    setStatus("drafted — review it in the LinkedIn tab, then confirm in this popup");
    return; // polling stays paused until the popup reports sent/skipped
  }

  // Nothing to review (already pending, no button found, not logged in, etc.) — this is a
  // terminal outcome with no human step, report it and move on exactly as before.
  if (outcome.tabId) chrome.tabs.remove(outcome.tabId).catch(() => {});
  try {
    await fetch(`${apiBase}/api/linkedin/queue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: action.id, status: outcome.status, result: outcome.result }),
    });
  } catch { /* reconciled on the next poll */ }

  recordStat(stats, outcome.status);
  setStatus(`action ${outcome.status}: ${outcome.result}`, outcome.status === "failed");

  const delay = pacing.minDelaySec + Math.random() * (pacing.maxDelaySec - pacing.minDelaySec);
  schedule(delay);
}

function recordStat(stats, status) {
  const today = new Date().toDateString();
  const s = stats && stats.day === today ? stats : { day: today, sent: 0, failed: 0, skipped: 0 };
  s[status] = (s[status] || 0) + 1;
  s.lastAt = Date.now();
  chrome.storage.local.set({ stats: s });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === POLL_ALARM) pollOnce(); });
chrome.runtime.onInstalled.addListener(() => { setStatus("installed"); schedule(5); });
chrome.runtime.onStartup.addListener(() => schedule(5));

// The service worker is torn down when idle and revived by events. Re-arming on
// every revival is what guarantees a heartbeat exists even if one was somehow
// lost — the alarm is created only when absent, so this cannot stack them.
ensureHeartbeat();
chrome.storage.onChanged.addListener((ch) => { if (ch.enabled && ch.enabled.newValue) { setStatus("started"); schedule(3); } });

/**
 * Injected into the LinkedIn profile page. Fills the invite note or message box and stops —
 * it never clicks Send. Best-effort DOM automation for the fill step only; LinkedIn changes
 * its markup often, so selectors are defensive and every path reports a clear outcome.
 */
async function fillLinkedInAction(action) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const btnByLabel = (re) =>
    all('button, a[role="button"]').find((b) => re.test(((b.getAttribute("aria-label") || b.textContent || "").trim())));

  // Bail early if LinkedIn bounced us to a login/checkpoint page.
  if (/\/(login|checkpoint|authwall)/.test(location.pathname) || document.querySelector('input[name="session_key"]')) {
    return { status: "failed", result: "not logged in to LinkedIn in this browser" };
  }

  await sleep(2500 + Math.random() * 2500); // let the profile settle

  // The 300-character ceiling is LinkedIn's limit on an INVITE note. A direct
  // message has no such limit worth worrying about (~8k), and clamping both
  // meant every DM longer than 300 characters was silently cut mid-sentence.
  const raw = action.note || "";
  const inviteNote = raw.slice(0, 300);
  const autoSend = action.autoSend === true;

  const pending = btnByLabel(/pending/i);
  const messageBtn = btnByLabel(/^Message\b/i);

  /** The modal LinkedIn opens for an invitation, if one is open. */
  const openModal = () => document.querySelector('.artdeco-modal[role="dialog"], div[role="dialog"]');

  async function fillMessage() {
    const mb = messageBtn || btnByLabel(/^Message\b/i);
    if (!mb) return { status: "skipped", result: "no Message button" };
    mb.click();
    await sleep(2800);
    const box = document.querySelector(
      '.msg-form__contenteditable[contenteditable="true"], .msg-form__contenteditable, div[role="textbox"][contenteditable="true"]'
    );
    if (!box) return { status: "failed", result: "message box not found" };
    box.focus();
    document.execCommand("insertText", false, raw || "Hi!");
    if (!autoSend) {
      return { status: "drafted", result: "message drafted — review it and click Send yourself", kind: "message" };
    }

    await sleep(600 + Math.random() * 700);
    const send =
      document.querySelector("button.msg-form__send-button:not([disabled])") ||
      all('button, a[role="button"]').find(
        (b) => /^send$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()) && !b.disabled,
      );
    if (!send) return { status: "failed", result: "auto-send on, but no enabled Send button in the message form" };
    send.click();

    // Confirm rather than assume. A click that did nothing must not be recorded
    // as a sent message — the CRM would claim contact that never happened, and
    // the sequence would move on to a follow-up.
    await sleep(1800);
    const after = document.querySelector(
      '.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]'
    );
    const cleared = !after || !(after.textContent || "").trim();
    return cleared
      ? { status: "sent", result: "message sent", kind: "message" }
      : { status: "failed", result: "clicked Send but the message box still has text — treating as not sent", kind: "message" };
  }

  async function fillInvite() {
    let connect = btnByLabel(/^(Connect|Invite)\b/i);
    if (!connect) {
      const more = btnByLabel(/^More\b/i);
      if (more) { more.click(); await sleep(1200); connect = btnByLabel(/^Connect\b/i); }
    }
    if (!connect) return null; // not invitable from here
    connect.click();
    await sleep(2200);
    const addNote = all("button").find((b) => /add a note/i.test((b.getAttribute("aria-label") || b.textContent || "")));
    if (inviteNote && addNote) {
      addNote.click();
      await sleep(1200);
      const ta = document.querySelector('textarea#custom-message, textarea[name="message"], textarea');
      if (ta) { ta.focus(); ta.value = inviteNote; ta.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    if (!autoSend) {
      return { status: "drafted", result: "invitation drafted — review it and click Send yourself", kind: "invite" };
    }

    await sleep(700 + Math.random() * 900);
    const scope = openModal() || document;
    const send =
      scope.querySelector('button[aria-label="Send now"]:not([disabled]), button[aria-label*="Send invitation"]:not([disabled])') ||
      Array.from(scope.querySelectorAll("button")).find(
        (b) => /^send( now| invitation)?$/i.test(((b.getAttribute("aria-label") || b.textContent || "").trim())) && !b.disabled,
      );
    if (!send) return { status: "failed", result: "auto-send on, but no enabled Send button in the invite dialog", kind: "invite" };
    send.click();

    // The dialog closing is the only evidence the invitation actually went.
    await sleep(2000);
    return !openModal()
      ? { status: "sent", result: "invitation sent", kind: "invite" }
      : { status: "failed", result: "clicked Send but the invite dialog is still open — treating as not sent", kind: "invite" };
  }

  try {
    if (pending) return { status: "skipped", result: "invite already pending" };
    if (action.type === "message") return await fillMessage();
    const invited = await fillInvite();
    if (invited) return invited;
    if (messageBtn) return await fillMessage(); // already connected → message instead
    return { status: "skipped", result: "no Connect or Message action available" };
  } catch (e) {
    return { status: "failed", result: String((e && e.message) || e) };
  }
}
