/**
 * The invite run.
 *
 * Opens a real Chromium window on the customer's own machine and own IP, works
 * through the queue the app hands it, and reports each outcome back. The server
 * side is unchanged from the Chrome extension's: same bearer token, same
 * /api/linkedin/queue, same daily caps and CRM side effects. What changed is
 * where the browser lives.
 *
 * Two rules govern the whole file:
 *
 *   1. Never report a send that did not happen. A "sent" row moves the lead to
 *      contacted and lets a sequence advance to a follow-up; claiming contact
 *      that never occurred is worse than reporting a failure.
 *   2. Stop early rather than push through. Consecutive failures, a login wall
 *      or LinkedIn's own limit dialog all end the batch. Grinding through
 *      nineteen more actions after LinkedIn has started saying no is how an
 *      account gets restricted.
 */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright-core");
const { fillLinkedInAction } = require("./page-actions");
const { pilotAction } = require("./pilot");

/**
 * The daily ceiling, enforced here as well as on the server.
 *
 * LinkedIn's practical invite allowance is about 20 a day for a normal account
 * (roughly 100/week, and it tightens for new or low-activity accounts). The
 * server's claimActions already stops handing out work at the account's
 * dailyInviteCap, but a client that trusts the server to say no is a client
 * that sends 200 invites the day the server is wrong.
 */
const MAX_PER_DAY = 20;

/** Give up on the batch after this many failures in a row. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Fallbacks when the server does not state its own pacing. */
const DEFAULT_PACING = { minDelaySec: 45, maxDelaySec: 120 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The leave-this-window-alone banner, injected into every page the run opens.
 *
 * The warning has to live where the person's hands are. A notice in the control
 * panel is not read by someone who has already alt-tabbed into the Chrome
 * window to check something — so it is pinned to the top of the automated
 * window itself, on every page, for as long as the run lasts.
 *
 * It says "this window", not "this computer". Every click the run makes is a DOM
 * click dispatched into the page, which needs neither focus nor visibility, so
 * the rest of the machine stays usable. Overstating it would only teach people
 * to ignore the banner.
 *
 * pointer-events:none, and marked with data-followthroo-overlay, so it can
 * neither swallow a click nor be mistaken for page furniture by the selector
 * logic in page-actions.js.
 */
function bannerInitScript() {
  const install = () => {
    if (document.querySelector("[data-followthroo-overlay]")) return;
    const bar = document.createElement("div");
    bar.setAttribute("data-followthroo-overlay", "1");
    bar.style.cssText = [
      "position:fixed",
      "inset:0 0 auto 0",
      "z-index:2147483647",
      "pointer-events:none",
      "background:#b91c1c",
      "color:#fff",
      "font:600 13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif",
      "padding:9px 14px",
      "text-align:center",
      "box-shadow:0 2px 10px rgba(0,0,0,.28)",
    ].join(";");
    bar.textContent =
      "Followthroo is working in this window — please leave it alone. Carry on using the rest of your computer.";
    (document.body || document.documentElement).appendChild(bar);
  };
  // Expose an updater so the run can show progress without re-injecting.
  window.__ftBanner = (text) => {
    install();
    const bar = document.querySelector("[data-followthroo-overlay]");
    if (bar && text) bar.textContent = text;
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
}

/**
 * A record of what the run actually saw and chose.
 *
 * LinkedIn's markup cannot be reproduced here — no fixture matches a real
 * profile, and the pages that fail belong to somebody else's account. Several
 * rounds of this were spent inferring the DOM from a one-line error, so the run
 * now writes down every observation and every decision. One file, sent along
 * with a report, replaces the guessing.
 *
 * Element labels and the note are in here. Both are already visible to whoever
 * is running it, and the file stays on their machine.
 */
function makeLog(userDataPath) {
  const dir = path.join(userDataPath, "logs");
  const file = path.join(
    dir,
    `run-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
  );
  let broken = false;
  return {
    file,
    write(entry) {
      if (broken) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(
          file,
          JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
        );
      } catch {
        // Logging must never take down a run that is otherwise working.
        broken = true;
      }
    },
  };
}

/** Small fetch wrapper that never throws a bare network error at the caller. */
async function api(apiBase, pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      // Identifies this as the desktop app. The queue hands actions to nothing
      // else, so an old Chrome extension still polling with the same token gets
      // an empty list instead of racing us for the same person.
      "X-Followthroo-Client": "desktop",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401)
    throw new Error(
      "Your pairing token was rejected. Copy a fresh one from Followthroo → LinkedIn.",
    );
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Server returned ${res.status}`);
  }
  return json.data;
}

/**
 * Where the LinkedIn session lives: a browser profile folder belonging to this
 * app, not the customer's everyday Chrome.
 *
 * Chrome refuses to open a profile directory that another Chrome already has
 * open, so borrowing the real one would mean asking them to quit their browser
 * before every run. A folder of our own means they log in once, here, and stay
 * logged in — and it keeps their LinkedIn session on their disk rather than in
 * our database, which is the whole reason this runs on the desktop.
 */
function profileDir(userDataPath) {
  return path.join(userDataPath, "linkedin-profile");
}

async function openBrowser({ userDataPath, headless = false }) {
  return chromium.launchPersistentContext(profileDir(userDataPath), {
    headless,
    channel: "chrome",
    viewport: null,
    args: [
      "--disable-blink-features=AutomationControlled",
      // The run must survive being ignored.
      //
      // All the pacing between actions is setTimeout running inside the page,
      // and Chrome throttles timers in background or covered windows to roughly
      // one a minute — so the moment someone puts another window on top, a
      // two-second wait becomes a minute and the run appears to hang. Since the
      // whole point is that they can carry on working, these three are what make
      // that true rather than merely claimed.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    // A run is paced in minutes, not milliseconds. The default 30s ceiling on
    // navigation is the only timeout worth keeping tight — everything else here
    // deliberately waits on a human-speed page.
    timeout: 60_000,
  });
}

const SIGNED_OUT = /\/(login|uas\/login|checkpoint|authwall)/;

/**
 * Get to a signed-in LinkedIn, waiting for the person if we have to.
 *
 * The first run of a fresh install has no session, and the honest thing to do
 * is open the login page and wait — which is why this waits rather than
 * reporting and giving up.
 *
 * Giving up is in fact not even available. The profile directory is locked by
 * the Chrome that has it open, so closing this window and asking them to press
 * Start again is a race at best; and closing it *while telling them to sign in
 * to it* is just wrong. So the window stays, and this polls until they are
 * through — including through a 2FA prompt, which is the slowest and most
 * common reason a first run takes minutes.
 */
async function waitForSignIn(
  context,
  { onEvent, shouldStop, timeoutMs = 5 * 60 * 1000 },
) {
  const page = context.pages()[0] || (await context.newPage());
  await page
    .goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await sleep(2500);
  if (!SIGNED_OUT.test(page.url())) return { signedIn: true, page };

  onEvent({
    type: "needs-signin",
    message:
      "Sign in to LinkedIn in the window that just opened. The run starts by itself once you're through.",
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop())
      return { signedIn: false, page, reason: "You stopped the run." };
    await sleep(2000);
    // A closed tab is the person answering "not now".
    if (page.isClosed())
      return {
        signedIn: false,
        page,
        reason: "The sign-in window was closed.",
      };
    if (!SIGNED_OUT.test(page.url())) {
      onEvent({ type: "status", message: "Signed in. Starting…" });
      await sleep(1500);
      return { signedIn: true, page };
    }
  }
  return {
    signedIn: false,
    page,
    reason: "Gave up waiting for sign-in. Press Start when you're ready.",
  };
}

/**
 * Work the queue until it is empty, the cap is reached, or something says stop.
 *
 * `onEvent` is how the control panel learns anything — every state change goes
 * through it, so a run that appears to do nothing always has a reason on screen.
 * `shouldStop` is polled between actions so Stop takes effect at the next safe
 * boundary rather than mid-invitation.
 */
async function runBatch({
  apiBase,
  token,
  userDataPath,
  /**
   * Is a personalised note still within today's allowance?
   *
   * LinkedIn permits only a few notes a day. Spending them on whoever happens to
   * be first in the queue means every later invitation goes without one anyway —
   * so the budget is checked per action, and an invitation without a note is
   * still an invitation. Injected so the runner need not know where the count
   * is kept.
   */
  noteAllowed = () => true,
  /** Called when an invitation actually carried a note. */
  onNoteUsed = () => {},
  limit = MAX_PER_DAY,
  dryRun = false,
  onEvent = () => {},
  shouldStop = () => false,
  /**
   * How the browser gets opened. Overridden only by
   * scripts/verify-desktop-runner.ts, which supplies a context whose requests
   * are fulfilled from a local fixture — the stop conditions below decide
   * whether real invitations keep going out, and they are worth testing
   * without a LinkedIn account to test them against.
   */
  launch = openBrowser,
}) {
  const summary = {
    sent: 0,
    failed: 0,
    skipped: 0,
    attempted: 0,
    stoppedBecause: null,
  };
  const emit = (type, payload = {}) => onEvent({ type, ...payload });

  const cap = Math.max(0, Math.min(limit, MAX_PER_DAY));
  const log = makeLog(userDataPath);
  log.write({ event: "run-start", cap, dryRun, apiBase });

  /**
   * A ceiling on tries, not just on sends.
   *
   * The loop below runs until `sent` reaches the cap, and a skipped action
   * raises neither `sent` nor the failure counter — so a queue full of people
   * who already have a pending invitation advances nothing. In practice the
   * queue drains, because a skip is reported as terminal and is not handed out
   * again. But that is a fact about the server, and this loop should not be one
   * server bug away from asking for work forever.
   */
  const maxAttempts = cap * 3 + 10;

  /** How many times one person is retried before the run accepts defeat. */
  const MAX_ATTEMPTS_PER_LEAD = 3;

  /**
   * What "cap" counts.
   *
   * A real run is limited by invitations actually sent, because that is what
   * LinkedIn is counting. A test run never sends anything, so counting sends
   * there means the loop can never reach its limit — it asked for three, got
   * three drafts, and went back for more forever. Only the attempt is
   * meaningful when nothing is being sent.
   */
  const progress = () => (dryRun ? summary.attempted : summary.sent);
  emit("status", { message: "Starting Chrome…" });

  let context;
  try {
    context = await launch({ userDataPath });
  } catch (e) {
    // The most common cause by far, and the least obvious from the raw error.
    const hint = /executable doesn't exist|Failed to launch/i.test(
      String(e && e.message),
    )
      ? "Google Chrome could not be started. Install Chrome, then try again."
      : String((e && e.message) || e);
    summary.stoppedBecause = hint;
    emit("fatal", { message: hint });
    return summary;
  }

  try {
    await context.addInitScript(bannerInitScript);

    emit("status", { message: "Checking your LinkedIn session…" });
    const { signedIn, page, reason } = await waitForSignIn(context, {
      onEvent,
      shouldStop,
    });
    if (!signedIn) {
      summary.stoppedBecause = reason;
      emit("fatal", { message: reason });
      return summary;
    }

    let consecutiveFailures = 0;

    while (progress() < cap) {
      if (shouldStop()) {
        summary.stoppedBecause = "You stopped the run.";
        emit("status", { message: summary.stoppedBecause });
        break;
      }

      if (summary.attempted >= maxAttempts) {
        summary.stoppedBecause = `Stopped after ${maxAttempts} attempts with only ${summary.sent} sent — the queue keeps returning people who cannot be invited.`;
        emit("fatal", { message: summary.stoppedBecause });
        break;
      }

      emit("status", { message: "Looking for the next person…" });

      let data;
      try {
        data = await api(apiBase, "/api/linkedin/queue?limit=1", { token });
      } catch (e) {
        summary.stoppedBecause = String((e && e.message) || e);
        emit("fatal", { message: summary.stoppedBecause });
        break;
      }

      const pacing = data.pacing || DEFAULT_PACING;
      const action = (data.actions || [])[0];
      if (!action) {
        summary.stoppedBecause =
          summary.attempted === 0
            ? "Nothing is queued. Add leads with a LinkedIn URL to a campaign, or send invites from the Leads screen."
            : "Queue is empty — everything available has been worked through.";
        emit("status", { message: summary.stoppedBecause });
        break;
      }

      // Automatic sending is a switch in the web app, told to us per action so
      // turning it off there stops the very next invitation with nothing to
      // change here. A dry run forces the draft path: fill everything, click
      // nothing.
      const autoSend = dryRun ? false : action.autoSend === true;
      if (!autoSend && !dryRun) {
        summary.stoppedBecause =
          'Automatic sending is off. Turn on "Send invites automatically" in Followthroo → LinkedIn, then press Start.';
        emit("fatal", { message: summary.stoppedBecause });
        break;
      }

      summary.attempted++;
      const who = action.leadName || action.linkedinUrl;
      emit("action-start", {
        who,
        url: action.linkedinUrl,
        kind: action.type,
        index: summary.attempted,
        cap,
      });

      let outcome;
      // Stay on this person until it works.
      //
      // A failure is usually the page rather than the person — it rendered
      // slowly, the menu did not open, the model chose wrong once. Moving
      // straight on burns the queue on transient problems and produces a run
      // reporting twenty failures that were mostly one retryable thing.
      //
      // The retry stays inside this iteration, on the action already claimed:
      // going back to the top of the loop would claim somebody *else* and
      // abandon the person it was meant to be retrying.
      //
      // Bounded, because some profiles genuinely cannot be connected to, and a
      // run that never advances is worse than one that gives up — it would sit
      // on a single follow-only profile until the day's allowance expired.
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_LEAD; attempt++) {
        if (attempt > 1) {
          log.write({
            event: "retry",
            who,
            attempt,
            previous: outcome?.result,
          });
          emit("status", {
            message: `${who}: ${outcome?.result || "did not work"} — trying again (${attempt} of ${MAX_ATTEMPTS_PER_LEAD})`,
          });
          await sleep(4000);
        }
        try {
          await page.goto(action.linkedinUrl, {
            waitUntil: "domcontentloaded",
          });
          await page
            .evaluate(
              (text) => window.__ftBanner && window.__ftBanner(text),
              `Followthroo is working in this window — leave it alone. Sending ${progress() + 1} of ${cap}.`,
            )
            .catch(() => {});

          // The model drives. It reads whatever is actually on the page, which is
          // what LinkedIn kept changing out from under a selector — Connect on the
          // card, Connect in an overflow menu, Connect renamed.
          outcome = await pilotAction({
            page,
            action: { ...action, autoSend },
            apiBase,
            token,
            // Checked per action rather than once per run: the allowance is
            // spent as the run goes, so the fourth invitation of the day should
            // go without a note even though the first three carried one.
            useNote: noteAllowed(),
            onStep: (s) => {
              log.write({ event: "step", who, url: action.linkedinUrl, ...s });
              emit("status", {
                message: s.refused
                  ? `Ignored an unsafe suggestion: ${s.refused}`
                  : `Working on ${who}: ${s.decision?.reason || s.decision?.action || "thinking"}`,
              });
            },
          });

          // Only when no model is configured at all. The selector path still
          // works for the common layouts and is better than refusing to run, but
          // it is a floor, not the plan.
          if (
            /No model is configured|not available on this deployment/i.test(
              outcome.result || "",
            )
          ) {
            const why = outcome.result;
            emit("status", {
              message:
                "No assistant available — falling back to the built-in rules.",
            });
            outcome = await page.evaluate(fillLinkedInAction, {
              ...action,
              autoSend,
            });
            // Say which path produced this. Without it, a fallback failure reads
            // as "the AI could not do it" when the AI was never asked — and the
            // real problem (an endpoint that is not deployed, a missing key) is
            // invisible in the one place anybody looks.
            outcome.result = `[no AI — ${why}] ${outcome.result}`;
          } else {
            outcome.result = `[AI] ${outcome.result}`;
          }
        } catch (e) {
          outcome = { status: "failed", result: String((e && e.message) || e) };
        }

        // Anything but a plain failure is final. "skipped" is a decision about
        // this person — already connected, no invitation to send — and retrying it
        // would only reach the same conclusion three times. A fatal stops the
        // whole run, so retrying is worse than pointless.
        if (outcome.status !== "failed" || outcome.fatal) break;
      }

      // A dry run reports nothing to the server: the point is to watch what it
      // would do without leaving a trace in the CRM or spending a day's quota.
      if (!dryRun) {
        await api(apiBase, "/api/linkedin/queue", {
          method: "POST",
          token,
          body: {
            actionId: action.id,
            status: outcome.status,
            result: outcome.result,
          },
        }).catch(() => {
          // Best effort. The server reclaims a stale in_progress row after 15
          // minutes, so a dropped report costs a retry, not a lost action.
        });
      }

      if (outcome.status === "sent") summary.sent++;
      else if (outcome.status === "failed") summary.failed++;
      else summary.skipped++;

      // Spend the allowance only on a note that was actually typed and sent.
      // Charging for an attempt would exhaust three notes on three failures and
      // leave the ones that worked without any.
      if (outcome.status === "sent" && outcome.noteUsed) onNoteUsed();

      log.write({
        event: "action-done",
        who,
        url: action.linkedinUrl,
        status: outcome.status,
        result: outcome.result,
        noteUsed: !!outcome.noteUsed,
      });
      emit("action-done", {
        who,
        status: outcome.status,
        result: outcome.result,
        sent: progress(),
        cap,
      });

      // LinkedIn itself has said stop — a login wall or its own limit dialog.
      // Every remaining action would hit the same wall.
      if (outcome.fatal) {
        summary.stoppedBecause = outcome.result;
        emit("fatal", { message: outcome.result });
        break;
      }

      consecutiveFailures =
        outcome.status === "failed" ? consecutiveFailures + 1 : 0;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.stoppedBecause = `Stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row — something has changed on LinkedIn, or this account is being throttled.`;
        emit("fatal", { message: summary.stoppedBecause });
        break;
      }

      if (progress() >= cap) {
        summary.stoppedBecause = dryRun
          ? `Test run finished — ${cap} people opened, nothing sent.`
          : `Daily limit reached — ${cap} invitations sent.`;
        emit("status", { message: summary.stoppedBecause });
        break;
      }

      // The pause between actions is the single most important thing here.
      // Twenty invitations fired back to back look nothing like a person and
      // are exactly what gets an account flagged.
      const waitSec = Math.round(
        pacing.minDelaySec +
          Math.random() * Math.max(0, pacing.maxDelaySec - pacing.minDelaySec),
      );
      emit("waiting", { seconds: waitSec, sent: progress(), cap });
      for (let i = waitSec; i > 0; i--) {
        if (shouldStop()) break;
        await page
          .evaluate(
            (text) => window.__ftBanner && window.__ftBanner(text),
            `Followthroo is working in this window — leave it alone. ${progress()} of ${cap} sent · next in ${i}s`,
          )
          .catch(() => {});
        emit("tick", { remaining: i });
        await sleep(1000);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  log.write({ event: "run-end", ...summary });
  emit("done", { ...summary, logFile: log.file });
  return summary;
}

module.exports = {
  runBatch,
  MAX_PER_DAY,
  MAX_CONSECUTIVE_FAILURES,
  profileDir,
  openBrowser,
  waitForSignIn,
};
