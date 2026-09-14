/**
 * The enrichment lane: after the invite lane empties or hits its cap, work
 * through Contact-info lookups the same already-open browser, at the same
 * humanized pace.
 *
 * Deliberately much simpler than connect-flow.js. Reading a page is not
 * sending anything — there is no note or Send button. Deterministic DOM
 * selectors run first, then the documented overlay URL, and finally a tightly
 * constrained assistant may choose only this profile's Contact info control.
 */
const { readContactInfo } = require("./page-actions");
const { observe, act, FORBIDDEN } = require("./pilot-page");
const { askServer } = require("./pilot");
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

async function trustedClick(page, outcome) {
  if (!outcome || !outcome.ok || outcome.action !== "click") return false;
  let clicked = false;
  if (outcome.selector) {
    try {
      await page.click(outcome.selector, { timeout: 2000, noWaitAfter: true });
      clicked = true;
    } catch (_) {}
  }
  if (!clicked && outcome.point && Number.isFinite(outcome.point.x) && Number.isFinite(outcome.point.y)) {
    try {
      await page.mouse.click(outcome.point.x, outcome.point.y);
      clicked = true;
    } catch (_) {}
  }
  await page
    .evaluate(() => document.querySelectorAll("[data-ft-act]").forEach((el) => el.removeAttribute("data-ft-act")))
    .catch(() => {});
  return clicked;
}

async function readContactInfoWithFallback({ page, lookup, apiBase, token, log }) {
  const identity = await page.evaluate(observe);
  const wantedSlug = new URL(lookup.linkedinUrl).pathname.match(/^\/in\/([^/]+)/)?.[1];
  const actualSlug = new URL(identity.url).pathname.match(/^\/in\/([^/]+)/)?.[1];
  if (wantedSlug && actualSlug && decodeURIComponent(wantedSlug) !== decodeURIComponent(actualSlug)) {
    return { status: "failed", result: `landed on /in/${actualSlug} but this lookup is for /in/${wantedSlug} — not reading the wrong profile` };
  }

  const first = await page.evaluate(readContactInfo);
  if (first.status !== "failed" || !/Contact info (link|overlay)/i.test(first.result || "")) return first;

  // The deterministic pass already established 1st-degree status. Try the
  // documented overlay route next, even if LinkedIn moved the visible link.
  const overlayUrl = contactOverlayUrl(lookup.linkedinUrl);
  if (overlayUrl) {
    try {
      await page.goto(overlayUrl, { waitUntil: "domcontentloaded" });
      await sleep(1200);
      const direct = await page.evaluate(readContactInfo, { confirmedFirstDegree: true, alreadyOpen: true });
      if (direct.status !== "failed") return direct;
      log.write({ event: "enrich-direct-overlay-missed", who: lookup.leadName || lookup.linkedinUrl, result: direct.result });
    } catch (error) {
      log.write({ event: "enrich-direct-overlay-failed", error: String((error && error.message) || error) });
    }
  }

  // One constrained assistant decision is the final fallback. It must name an
  // indexed Contact info control from the profile owner's top card. The page
  // veto repeats these checks before producing a trusted Playwright click.
  await page.goto(lookup.linkedinUrl, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const seen = await page.evaluate(observe);
  const screenshot = (await page.screenshot({ type: "jpeg", quality: 55, fullPage: false })).toString("base64");
  let decision;
  try {
    decision = await askServer(apiBase, token, {
      goal: "enrich",
      personName: seen.personName || lookup.leadName || "",
      note: null,
      autoSend: false,
      useNote: false,
      url: seen.url,
      step: 0,
      history: [],
      elements: seen.elements.slice(0, 150),
      screenshot,
      viewport: page.viewportSize() || null,
    });
  } catch (error) {
    return { status: "failed", result: `Contact info selector changed and the assistant was unavailable: ${String((error && error.message) || error)}` };
  }

  if (decision.action !== "click" || decision.index === undefined || decision.label || decision.x !== undefined || decision.y !== undefined) {
    return { status: "failed", result: `Contact info selector changed and the assistant stopped safely: ${decision.reason || "no safe indexed control"}` };
  }
  const candidate = seen.elements.find((element) => element.i === decision.index);
  if (!candidate || !candidate.inTopCard || candidate.inAside || !/contact info/i.test(candidate.label || "")) {
    return { status: "failed", result: "Contact info selector changed and the assistant did not identify a safe profile-owned control" };
  }

  const outcome = await page.evaluate(act, {
    decision,
    expectedName: seen.personName,
    forbiddenSource: FORBIDDEN.source,
    goal: "enrich",
    autoSend: false,
  });
  if (!(await trustedClick(page, outcome))) {
    return { status: "failed", result: outcome.error || "Contact info control could not be clicked safely" };
  }
  await sleep(1200);
  return page.evaluate(readContactInfo, { confirmedFirstDegree: true, alreadyOpen: true });
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
      await page
        .evaluate((text) => window.__ftBanner && window.__ftBanner(text), `Followthroo · looking up contact info for ${who}`)
        .catch(() => {});
      await sleep(1500 + Math.random() * 1000);
      outcome = await readContactInfoWithFallback({ page, lookup, apiBase, token, log });
    } catch (e) {
      outcome = { status: "failed", result: String((e && e.message) || e) };
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
          degree: outcome.degree === "1st" ? "1st" : outcome.degree === "not_1st" ? null : null,
          email: outcome.email ?? null,
          phone: outcome.phone ?? null,
          extra: outcome.extra ?? {},
          result: outcome.result,
        },
      });
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
