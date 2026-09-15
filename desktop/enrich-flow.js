/**
 * The enrichment lane: after the invite lane empties or hits its cap, work
 * through Contact-info lookups the same already-open browser, at the same
 * humanized pace.
 *
 * Deliberately much simpler than connect-flow.js. Reading a page is not
 * sending anything — there is no note or Send button. Deterministic DOM
 * selectors run first, then the documented overlay URL. Both are driven by
 * Playwright in the same persistent Chrome session as invitations.
 */
const fs = require("node:fs");
const path = require("node:path");
const { readContactInfo } = require("./page-actions");
const { observe } = require("./pilot-page");
const { CODES } = require("./outcome-codes");
const { requestJson } = require("./api-client");
const { openBrowser, waitForSignIn, bannerInitScript, makeLog } = require("./runner");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long to keep looking before calling an overlay absent: ~3.2s. */
const OVERLAY_TRIES = 8;
const OVERLAY_GAP_MS = 400;

/**
 * Look again until the overlay is readable, a terminal answer arrives, or the
 * budget runs out.
 *
 * Shaped after connect-flow.js's observeUntil, and here for the same reason it
 * exists there: LinkedIn renders a dialog's shell before its rows, so one look
 * decides nothing. The version this replaces looked exactly once, 900ms after
 * the click, and reported every slow render as "overlay did not open". Each
 * try is a fresh page.evaluate, so a re-render between looks is picked up
 * rather than missed.
 */
async function pollContactInfo(page, { clickTrigger = false } = {}) {
  let last = { status: "waiting", state: "UNKNOWN", result: "Contact info overlay is not open yet" };
  for (let i = 0; i < OVERLAY_TRIES; i++) {
    last = await page.evaluate(readContactInfo, {
      confirmedFirstDegree: true,
      // Only the first look may click; the rest are pure observation.
      clickTrigger: clickTrigger && i === 0,
    });
    if (last.status !== "waiting") return last;
    await sleep(OVERLAY_GAP_MS);
  }
  return last;
}

/** The expensive full-page walk, asked for once, only after giving up. */
async function collectDiagnostics(page) {
  try {
    const out = await page.evaluate(readContactInfo, { confirmedFirstDegree: true, diagnoseOnly: true });
    return (out && out.diagnostics) || null;
  } catch (error) {
    return { diagnoseError: String((error && error.message) || error) };
  }
}

/**
 * What the next fix needs and no log line can supply: the panel's real markup,
 * and a picture of the screen at the moment it was declared absent.
 *
 * Five builds in a row guessed at these selectors because nobody could see
 * what LinkedIn actually rendered. Written beside the run's own JSONL log, on
 * the machine that did the reading. Never uploaded — it holds a real person's
 * contact details — and it carries no cookies, tokens or storage.
 */
async function captureFailure(page, { lookup, log, diagnostics }) {
  const dir = path.dirname(log.file);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `enrichment-${stamp}-${String(lookup.leadId || "lead").slice(0, 8)}-contact-info-failure`;
  const written = {};
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (diagnostics && diagnostics.html) {
      const htmlFile = path.join(dir, `${base}.html`);
      fs.writeFileSync(htmlFile, diagnostics.html, "utf8");
      written.htmlFile = htmlFile;
    }
    const shotFile = path.join(dir, `${base}.png`);
    await page.screenshot({ path: shotFile, fullPage: false });
    written.screenshotFile = shotFile;
  } catch (error) {
    written.captureError = String((error && error.message) || error);
  }
  log.write({
    event: "CONTACT_INFO_FAILURE",
    who: lookup.leadName || lookup.linkedinUrl,
    enrichmentId: lookup.id,
    ...(diagnostics || {}),
    // The markup goes to its own file rather than bloating every log line.
    html: undefined,
    ...written,
  });
  return written;
}

function contactOverlayUrl(profileUrl) {
  const url = new URL(profileUrl);
  const match = url.pathname.match(/^(\/in\/[^/]+)/);
  if (!match) return null;
  url.pathname = `${match[1]}/overlay/contact-info/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readContactInfoWithFallback({ page, lookup, log, onDebug = () => {} }) {
  const who = lookup.leadName || lookup.linkedinUrl;
  const debug = (message, extra = {}) => {
    log.write({ event: "enrich-debug", who, message, ...extra });
    onDebug({ who, message, ...extra });
  };
  const identity = await page.evaluate(observe);
  const wantedSlug = new URL(lookup.linkedinUrl).pathname.match(/^\/in\/([^/]+)/)?.[1];
  const actualSlug = new URL(identity.url).pathname.match(/^\/in\/([^/]+)/)?.[1];
  if (wantedSlug && actualSlug && decodeURIComponent(wantedSlug) !== decodeURIComponent(actualSlug)) {
    return { status: "failed", result: `landed on /in/${actualSlug} but this lookup is for /in/${wantedSlug} — not reading the wrong profile` };
  }

  // `observe()` is the same ownership-aware reader used by invitations. If a
  // just-shipped layout prevents it from finding the top card, the independent
  // page-action reader gets one chance to supply *positive* header evidence.
  // An observed 2nd/3rd degree is never overridden.
  let degree = identity.connectionDegree || { degree: "unknown", evidence: "profile degree was not observed" };
  if (degree.degree === "unknown") {
    const header = await page.evaluate(readContactInfo, { eligibilityOnly: true });
    if (header.status === "eligible") degree = header;
    else if (header.evidence) degree = header;
  }
  if (degree.degree !== "1st") {
    const result = degree.degree === "unknown"
      ? "could not verify a 1st-degree connection safely; Contact info was not opened"
      : `detected ${degree.degree}-degree connection; Contact info is only shown for 1st-degree connections`;
    debug(result, { status: "skipped", degree: degree.degree, evidence: degree.evidence, reasonCode: degree.degree === "unknown" ? "degree_unverified" : "degree_not_first" });
    return { status: "skipped", ...degree, reasonCode: degree.degree === "unknown" ? "degree_unverified" : "degree_not_first", result };
  }
  debug(`Verified 1st-degree connection (${degree.evidence}). Opening Contact info with Playwright.`, { degree: "1st", evidence: degree.evidence });

  // The Contact info control is part of the profile page, just like Connect.
  // Click it with Playwright (a trusted input, as the invitation lane clicks
  // Connect), then poll for the overlay. Limit the locator to the documented
  // Contact info overlay link in main, never a recommendation rail.
  const profileContact = page.locator('main a[href*="/overlay/contact-info"]', { hasText: /contact info/i }).first();
  let clickedWithPlaywright = false;
  try {
    if (await profileContact.isVisible().catch(() => false)) {
      await profileContact.click({ timeout: 3000, noWaitAfter: true });
      clickedWithPlaywright = true;
      debug("Clicked this profile's Contact info link with Playwright; waiting for its overlay.", { degree: "1st" });
    }
  } catch (error) {
    debug(`Playwright could not click the visible Contact info link: ${String((error && error.message) || error)}`, { degree: "1st" });
  }

  const report = (found, message) => {
    debug(message, { status: found.status, degree: found.degree, evidence: found.evidence });
    return found;
  };
  const readOut = (found) =>
    `Contact info read — ${found.email ? "email" : "no email"}${found.phone ? " and phone" : ""} available.`;

  // If Playwright could not see the link, the page reader gets one chance to
  // click it from inside the page instead.
  const first = await pollContactInfo(page, { clickTrigger: !clickedWithPlaywright });
  if (first.status === "done") return report(first, readOut(first));
  if (first.fatal) return report(first, first.result);
  log.write({ event: "CONTACT_INFO_STATE", who, route: "click", state: first.state, visibleDialogCount: first.visibleDialogCount, result: first.result });
  debug(`${first.result}; trying LinkedIn's Contact info overlay route.`, { degree: "1st" });

  // The deterministic pass already established 1st-degree status. Try the
  // documented overlay route next, even if LinkedIn moved the visible link.
  const overlayUrl = contactOverlayUrl(lookup.linkedinUrl);
  let direct = null;
  if (overlayUrl) {
    try {
      await page.goto(overlayUrl, { waitUntil: "domcontentloaded" });
      direct = await pollContactInfo(page);
      if (direct.status === "done") return report(direct, "Contact info opened through the overlay route.");
      if (direct.fatal) return report(direct, direct.result);
      log.write({ event: "CONTACT_INFO_STATE", who, route: "overlay-url", state: direct.state, visibleDialogCount: direct.visibleDialogCount, result: direct.result });
      debug(`Overlay route did not work: ${direct.result}`, { degree: "1st" });
    } catch (error) {
      log.write({ event: "enrich-direct-overlay-failed", error: String((error && error.message) || error) });
      debug(`Overlay route failed: ${String((error && error.message) || error)}`, { degree: "1st" });
    }
  }

  // Both routes are spent. Save what the page actually looked like, so the
  // next fix is written from its markup instead of guessed at again.
  const worst = direct || first;
  const diagnostics = worst.diagnostics || (await collectDiagnostics(page));
  const saved = await captureFailure(page, { lookup, log, diagnostics });
  debug(
    saved.htmlFile
      ? `Contact info could not be read (${worst.state || "unknown"}). Saved the overlay's markup and a screenshot to ${path.dirname(log.file)}.`
      : `Contact info could not be read (${worst.state || "unknown"}). Saved a screenshot to ${path.dirname(log.file)}.`,
    { status: "failed", degree: "1st" },
  );
  return {
    status: "failed",
    degree: "1st",
    // Keep the specific reason when there is one — "the profile has no Contact
    // info link" and "the overlay opened and could not be parsed" send whoever
    // reads this to different places.
    reasonCode: worst.reasonCode || (worst.state === "CLOSED" ? "overlay_not_detected" : "overlay_unreadable"),
    result: `Contact info overlay could not be read (state: ${worst.state || worst.reasonCode || "unknown"}). Its markup and a screenshot were saved locally for diagnosis.`,
  };
}

/** Same credential-safe HTTP boundary used by the invitation lane and pilot. */
async function api(apiBase, pathname, { method = "GET", token, body, operation, retry } = {}) {
  return requestJson(apiBase, pathname, { method, token, body, operation, retry });
}

/**
 * Work the enrichment queue until it is empty, `cap` lookups have run, or
 * something says stop. Mirrors runBatch's shape in runner.js closely enough
 * that the two read as one story in the logs, but is its own function: an
 * enrichment lookup's failure modes (page changed, profile gone, overlay
 * never opened) are not the invite lane's (login wall, weekly limit), and
 * conflating them would mean one lane's stop reason gets misreported as the
 * other's.
 */
async function runEnrichmentLane({ page, apiBase, token, cap, log, onEvent = () => {}, shouldStop = () => false }) {
  const summary = { done: 0, skipped: 0, failed: 0, retrying: 0, attempted: 0, stoppedBecause: null };
  const emit = (type, payload = {}) => onEvent({ type, ...payload });
  if (cap <= 0) return summary;

  // Same stop conditions as the invite lane, and for the same reason: a run
  // that keeps trying after LinkedIn has started saying no is how an account
  // gets restricted, whichever lane is running.
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;

  while (summary.attempted < cap) {
    if (shouldStop()) {
      summary.stoppedBecause = "You stopped the run.";
      break;
    }

    let data;
    try {
      data = await api(apiBase, "/api/linkedin/enrich/claim?limit=1", {
        token,
        operation: "Claim the next contact lookup",
        retry: "claim-connect",
      });
    } catch (e) {
      summary.stoppedBecause = String((e && e.message) || e);
      emit("fatal", { message: summary.stoppedBecause });
      break;
    }

    const lookup = (data.lookups || [])[0];
    if (!lookup) {
      summary.stoppedBecause = summary.attempted === 0 ? "Nothing to look up." : "Contact-info queue is empty.";
      emit("status", { message: summary.stoppedBecause });
      break;
    }

    summary.attempted++;
    const who = lookup.leadName || lookup.linkedinUrl;
    emit("enrich-start", { who, url: lookup.linkedinUrl, index: summary.attempted, cap });
    log.write({ event: "enrich-start", who, url: lookup.linkedinUrl });

    let outcome;
    try {
      await page.goto(lookup.linkedinUrl, { waitUntil: "domcontentloaded" });
      const debug = (details) => emit("enrich-debug", details);
      debug({ who, message: "Profile opened in the automation Playwright session." });
      await page
        .evaluate((text) => window.__ftBanner && window.__ftBanner(text), `Followthroo · looking up contact info for ${who}`)
        .catch(() => {});
      await sleep(1500 + Math.random() * 1000);
      outcome = await readContactInfoWithFallback({ page, lookup, log, onDebug: debug });
    } catch (e) {
      outcome = { status: "failed", result: String((e && e.message) || e) };
      emit("enrich-debug", { who, message: `Lookup failed before completion: ${outcome.result}`, status: "failed" });
    }

    const status = outcome.status === "done" ? "done" : outcome.status === "skipped" ? "skipped" : "failed";
    // A failed lookup the server will hand out again is one lead still in
    // flight, not a second casualty. Reported as "2 failed" before this, it
    // read as though the queue had two of the same person in it.
    let retrying = false;
    try {
      const reported = await api(apiBase, "/api/linkedin/enrich/complete", {
        method: "POST",
        token,
        operation: "Report contact lookup outcome",
        body: {
          enrichmentId: lookup.id,
          status,
          degree: ["1st", "2nd", "3rd", "out_of_network"].includes(outcome.degree) ? outcome.degree : null,
          email: outcome.email ?? null,
          phone: outcome.phone ?? null,
          extra: { ...(outcome.extra ?? {}), evidence: outcome.evidence ?? null, reasonCode: outcome.reasonCode ?? null },
          result: outcome.result,
        },
      });
      retrying = !!(reported && reported.retrying);
      const attempt = Number(lookup.attempts || 0) + 1;
      emit("enrich-debug", {
        who,
        message: retrying
          ? `Attempt ${attempt} of 3 did not work — Followthroo will try this lead again.`
          : "Lookup outcome recorded with Followthroo.",
        status,
      });
    } catch (e) {
      // Best effort, same as the invite lane: a dropped report costs a retry
      // (reclaimStale in lib/linkedin/enrich.ts), not a lost lookup.
      log.write({ event: "enrich-report-failed", who, error: String((e && e.message) || e) });
    }

    if (status === "done") summary.done++;
    else if (status === "skipped") summary.skipped++;
    else if (retrying) summary.retrying++;
    else summary.failed++;

    log.write({ event: "enrich-done", who, status, result: outcome.result, code: outcome.code || null });
    emit("enrich-done", { who, status, result: outcome.result, done: summary.attempted, cap });

    // A login wall stops every remaining lookup just as surely as it stops
    // every remaining invitation — there is no point trying nineteen more.
    if (/not logged in/i.test(outcome.result || "")) {
      summary.stoppedBecause = "Signed out of LinkedIn in this browser.";
      emit("fatal", { code: CODES.LINKEDIN_SESSION_INVALID, message: summary.stoppedBecause });
      break;
    }

    consecutiveFailures = status === "failed" ? consecutiveFailures + 1 : 0;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      summary.stoppedBecause = `Stopped after ${MAX_CONSECUTIVE_FAILURES} lookups in a row failed — something has likely changed on LinkedIn.`;
      emit("fatal", { message: summary.stoppedBecause });
      break;
    }

    if (summary.attempted >= cap) {
      summary.stoppedBecause = `Reached the batch limit — ${summary.attempted} looked up.`;
      break;
    }

    // 6-15s: the plan's own pacing for this lane, separate from and gentler
    // than the invite pacing — opening a profile's Contact info is a smaller
    // ask of LinkedIn than an invitation, but "smaller" is not "free", and
    // this lane runs at a much higher daily cap than invites do.
    const waitMs = 6000 + Math.random() * 9000;
    for (let waited = 0; waited < waitMs && !shouldStop(); waited += 500) await sleep(500);
  }

  return summary;
}

/**
 * A complete enrichment run with its own browser/session lifecycle. Invitation
 * sending never imports or calls this function; the two workflows share only
 * the persistent LinkedIn profile and main-process one-run-at-a-time lock.
 */
async function runEnrichmentBatch({
  apiBase,
  token,
  userDataPath,
  limit = 30,
  version = null,
  onEvent = () => {},
  shouldStop = () => false,
  launch = openBrowser,
}) {
  const cap = Math.max(0, Math.min(Number(limit) || 0, 30));
  const log = makeLog(userDataPath, "enrich");
  const emit = (type, payload = {}) => onEvent({ type, ...payload });
  log.write({ event: "run-start", lane: "enrich", cap, apiBase, version });

  let context;
  try {
    emit("status", { message: "Starting Chrome for contact lookups…" });
    context = await launch({ userDataPath });
  } catch (error) {
    const message = /executable doesn't exist|Failed to launch/i.test(String(error && error.message))
      ? "Google Chrome could not be started. Install Chrome, then try again."
      : String((error && error.message) || error);
    const summary = { done: 0, skipped: 0, failed: 0, retrying: 0, attempted: 0, stoppedBecause: message };
    log.write({ event: "run-end", ...summary });
    emit("fatal", { message });
    emit("done", { ...summary, logFile: log.file });
    return summary;
  }

  let summary = { done: 0, skipped: 0, failed: 0, retrying: 0, attempted: 0, stoppedBecause: null };
  try {
    await context.addInitScript(bannerInitScript);
    emit("status", { message: "Checking your LinkedIn session…" });
    const { signedIn, page, reason } = await waitForSignIn(context, { onEvent, shouldStop });
    if (!signedIn) {
      summary.stoppedBecause = reason;
      emit("fatal", { message: reason });
    } else {
      emit("status", { message: "Looking up contact info…" });
      summary = await runEnrichmentLane({
        page,
        apiBase,
        token,
        cap,
        log,
        onEvent,
        shouldStop,
      });
    }
  } finally {
    await context.close().catch(() => {});
  }

  log.write({ event: "run-end", lane: "enrich", ...summary });
  emit("done", { ...summary, logFile: log.file });
  return summary;
}

module.exports = { runEnrichmentLane, runEnrichmentBatch };
