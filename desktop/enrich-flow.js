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
const { readContactInfo } = require("./page-actions");
const { observe } = require("./pilot-page");
const { CODES } = require("./outcome-codes");
const { requestJson } = require("./api-client");
const { openBrowser, waitForSignIn, bannerInitScript, makeLog } = require("./runner");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // Click it with Playwright (rather than a synthetic in-page event), then let
  // the page reader inspect the visible overlay. Limit the locator to the
  // documented Contact info overlay link in main, never a recommendation rail.
  const profileContact = page.locator('main a[href*="/overlay/contact-info"]', { hasText: /contact info/i }).first();
  let openedWithPlaywright = false;
  try {
    if (await profileContact.isVisible({ timeout: 2500 })) {
      await profileContact.click({ timeout: 3000, noWaitAfter: true });
      openedWithPlaywright = true;
      debug("Clicked this profile's Contact info link with Playwright; waiting for its overlay.", { degree: "1st" });
      await sleep(900);
    }
  } catch (error) {
    debug(`Playwright could not click the visible Contact info link: ${String((error && error.message) || error)}`, { status: "failed", degree: "1st" });
  }

  const first = await page.evaluate(readContactInfo, {
    confirmedFirstDegree: true,
    alreadyOpen: openedWithPlaywright,
  });
  if (first.status !== "failed" || !/Contact info (link|overlay)/i.test(first.result || "")) {
    debug(first.status === "done"
      ? `Contact info read — ${first.email ? "email" : "no email"}${first.phone ? " and phone" : ""} available.`
      : first.result || "Contact lookup finished.", { status: first.status, degree: first.degree, evidence: first.evidence });
    return first;
  }
  debug(`${first.result}; trying LinkedIn's Contact info overlay route.`, { status: "failed", degree: "1st" });

  // The deterministic pass already established 1st-degree status. Try the
  // documented overlay route next, even if LinkedIn moved the visible link.
  const overlayUrl = contactOverlayUrl(lookup.linkedinUrl);
  if (overlayUrl) {
    try {
      await page.goto(overlayUrl, { waitUntil: "domcontentloaded" });
      await sleep(1200);
      const direct = await page.evaluate(readContactInfo, { confirmedFirstDegree: true, alreadyOpen: true });
      if (direct.status !== "failed") {
        debug(direct.status === "done" ? "Contact info opened through the overlay route." : direct.result || "Overlay lookup finished.", { status: direct.status, degree: direct.degree, evidence: direct.evidence });
        return direct;
      }
      log.write({ event: "enrich-direct-overlay-missed", who: lookup.leadName || lookup.linkedinUrl, result: direct.result });
      debug(`Overlay route did not work: ${direct.result}`, { status: "failed", degree: "1st" });
    } catch (error) {
      log.write({ event: "enrich-direct-overlay-failed", error: String((error && error.message) || error) });
      debug(`Overlay route failed: ${String((error && error.message) || error)}`, { status: "failed", degree: "1st" });
    }
  }

  return {
    status: "failed",
    degree: "1st",
    result: "Contact info opened but its overlay could not be read. The Activity log records the exact Playwright and overlay step that failed.",
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
  const summary = { done: 0, skipped: 0, failed: 0, attempted: 0, stoppedBecause: null };
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
    try {
      await api(apiBase, "/api/linkedin/enrich/complete", {
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
      emit("enrich-debug", { who, message: "Lookup outcome recorded with Followthroo.", status });
    } catch (e) {
      // Best effort, same as the invite lane: a dropped report costs a retry
      // (reclaimStale in lib/linkedin/enrich.ts), not a lost lookup.
      log.write({ event: "enrich-report-failed", who, error: String((e && e.message) || e) });
    }

    if (status === "done") summary.done++;
    else if (status === "skipped") summary.skipped++;
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
    const summary = { done: 0, skipped: 0, failed: 0, attempted: 0, stoppedBecause: message };
    log.write({ event: "run-end", ...summary });
    emit("fatal", { message });
    emit("done", { ...summary, logFile: log.file });
    return summary;
  }

  let summary = { done: 0, skipped: 0, failed: 0, attempted: 0, stoppedBecause: null };
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
