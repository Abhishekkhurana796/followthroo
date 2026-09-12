/**
 * The enrichment lane: after the invite lane empties or hits its cap, work
 * through Contact-info lookups the same already-open browser, at the same
 * humanized pace.
 *
 * Deliberately much simpler than connect-flow.js. Reading a page is not
 * sending anything — there is no note, no Send button, no "did this actually
 * go" confirmation to chase — so there is no model fallback here and no
 * pilot-page.js attribution dance. `page-actions.js`'s `readContactInfo`
 * already refuses to open anything for a profile it cannot positively
 * confirm is a 1st-degree connection, which is the one safety rule that
 * actually matters for this lane.
 */
const { readContactInfo } = require("./page-actions");
const { CODES } = require("./outcome-codes");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same tiny wrapper runner.js uses, duplicated rather than shared — these
 *  modules stay decoupled on purpose (pilot.js does the same). */
async function api(apiBase, pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Followthroo-Client": "desktop",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `Server returned ${res.status}`);
  return json.data;
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
      data = await api(apiBase, "/api/linkedin/enrich/claim?limit=1", { token });
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
      outcome = await page.evaluate(readContactInfo);
    } catch (e) {
      outcome = { status: "failed", result: String((e && e.message) || e) };
    }

    const status = outcome.status === "done" ? "done" : outcome.status === "skipped" ? "skipped" : "failed";
    try {
      await api(apiBase, "/api/linkedin/enrich/complete", {
        method: "POST",
        token,
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

module.exports = { runEnrichmentLane };
