/**
 * One action, driven by the model.
 *
 * Loop: describe the page, ask the server what to do, veto it if it is unsafe,
 * do it, look again. Up to MAX_STEPS, which is generous for "open the menu,
 * click Connect, add a note, type it, send" and short enough that a confused
 * model cannot wander around somebody's LinkedIn account.
 *
 * Why this replaced selectors: LinkedIn puts Connect on the card, behind an
 * overflow menu, or nowhere, and renames things. Every variant cost a release
 * and a fixture. The model sees whatever is actually there.
 *
 * What did NOT change is who is trusted. The model chooses an index out of a
 * list the page itself produced, and desktop/pilot-page.js refuses anything in
 * the sidebar, anything destructive, and anything whose label names a different
 * person. An invitation cannot be recalled, so a wrong answer has to cost a
 * failed action and nothing more.
 */
const { observe, act, FORBIDDEN } = require("./pilot-page");

const MAX_STEPS = 8;
/**
 * Attach a screenshot from the second step onward.
 *
 * It used to be the fourth, which meant it never happened: the model gave up at
 * step zero or one, so the fallback that was supposed to rescue a page the
 * element list could not describe was never reached. A give_up is also not
 * accepted until a screenshot has been shown at least once — see below.
 */
const SCREENSHOT_AFTER_STEP = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page in one line, for a failure message somebody has to act on. */
function describe(seen) {
  if (!seen || !seen.elements) return "nothing";
  return seen.elements
    .slice(0, 14)
    .map((e) => (e.inTopCard ? `*${e.label}*` : e.label))
    .join(" | ");
}

async function askServer(apiBase, token, observation) {
  const res = await fetch(`${apiBase}/api/linkedin/assist`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(observation),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `assist returned ${res.status}`);
  }
  return json.data.decision;
}

/**
 * Run one queued action to completion on an already-open profile page.
 *
 * Returns the same shape the selector path did — { status, result, fatal? } —
 * so the runner does not care which one produced it.
 */
async function pilotAction({ page, action, apiBase, token, onStep = () => {} }) {
  const goal = action.type === "message" ? "message" : "invite";
  const note = action.note || null;
  const autoSend = action.autoSend === true;
  const history = [];

  // Wait for the profile to actually be there, not merely for time to pass.
  //
  // LinkedIn serves the navbar immediately and hydrates the profile card after.
  // A fixed sleep meant sometimes observing a page that had a complete global
  // nav and no action row yet — and the model, shown a list of "Skip to main
  // content" and "For Business", correctly reported no Connect button.
  await sleep(1500 + Math.random() * 1000);
  let seen = await page.evaluate(observe);
  for (let i = 0; i < 12 && !seen.profileReady && !seen.signedOut; i++) {
    await sleep(1000);
    seen = await page.evaluate(observe);
  }

  if (seen.signedOut) {
    return { status: "failed", result: "not logged in to LinkedIn in this browser", fatal: "login" };
  }

  // The identity guard, unchanged and non-negotiable: a renamed vanity URL or a
  // stale link can land on somebody else entirely.
  const wantSlug = (action.linkedinUrl || "").replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  const haveSlug = new URL(seen.url).pathname.replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  if (wantSlug && haveSlug && decodeURIComponent(wantSlug) !== decodeURIComponent(haveSlug)) {
    return {
      status: "failed",
      result: `landed on /in/${haveSlug} but this action is for /in/${wantSlug} — not acting on the wrong profile`,
    };
  }

  // Decided here rather than by the model: it is a fact on the page, and an
  // explicit invitation to an existing connection has nothing to do.
  if (goal === "invite" && seen.firstDegree) {
    return { status: "skipped", result: "already connected — no invitation to send" };
  }

  let sawScreenshot = false;
  let forceScreenshot = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (seen.limitWall) {
      return { status: "failed", result: seen.limitWall, fatal: "limit" };
    }

    const wantShot = forceScreenshot || step >= SCREENSHOT_AFTER_STEP;
    const screenshot = wantShot
      ? (await page.screenshot({ type: "jpeg", quality: 55, fullPage: false })).toString("base64")
      : null;
    if (screenshot) sawScreenshot = true;
    forceScreenshot = false;

    let decision;
    try {
      decision = await askServer(apiBase, token, {
        goal,
        personName: seen.personName,
        note,
        autoSend,
        url: seen.url,
        step,
        history,
        elements: seen.elements,
        screenshot,
      });
    } catch (e) {
      // A model that is down is not a profile without a Connect button, and the
      // run has to be able to tell those apart.
      return { status: "failed", result: `could not reach the assistant: ${String((e && e.message) || e)}` };
    }

    // The elements go into the log too. A decision without the page it was made
    // from is not diagnosable — which is the whole reason this log exists.
    onStep({ step, decision, saw: seen.elements, personName: seen.personName });

    if (decision.action === "give_up") {
      const why = String(decision.reason || "").toLowerCase();
      if (/already connected/.test(why)) {
        return { status: "skipped", result: "already connected — no invitation to send" };
      }
      // Giving up before ever seeing the page is not a judgement, it is a guess.
      // The screenshot exists precisely for the pages the element list fails to
      // describe, so it has to be shown before "there is no Connect" is believed.
      if (!sawScreenshot) {
        history.push(`said "${decision.reason}" from the element list alone — look at the page itself`);
        forceScreenshot = true;
        await sleep(600);
        seen = await page.evaluate(observe);
        continue;
      }
      // Carry what was on screen. "Connect button not found" on its own cannot
      // be acted on by anyone who was not watching; the list of what was
      // actually there is what turns a report into a fix.
      return { status: "failed", result: `gave up: ${decision.reason}. Saw: ${describe(seen)}` };
    }

    if (decision.action === "done") {
      // Trust nothing: confirm against the page. A dialog still open means the
      // invitation did not go, and recording a send that did not happen moves
      // the lead to contacted and lets a sequence follow up on silence.
      const after = await page.evaluate(observe);
      if (after.limitWall) return { status: "failed", result: after.limitWall, fatal: "limit" };

      // "done" is a claim, not evidence. A model that answers done on the first
      // step without touching anything would otherwise be recorded as a sent
      // invitation — a lie in the CRM, and the sequence follows up on a
      // conversation that never started. Require that we actually clicked
      // something that invites.
      if (goal === "invite" && !history.some((h) => /clicked "(invite|connect)/i.test(h))) {
        return {
          status: "failed",
          result: "the assistant said it was done without ever clicking Connect — nothing was sent",
        };
      }

      if (goal === "invite" && after.dialogOpen) {
        return {
          status: "failed",
          result: "the assistant said it was done, but the invite dialog is still open — treating as not sent",
        };
      }
      if (!autoSend) {
        return { status: "drafted", result: "filled in and left for you to send", kind: goal };
      }
      return { status: "sent", result: goal === "invite" ? "invitation sent" : "message sent", kind: goal };
    }

    // `act` is passed by reference so Playwright serializes its source into the
    // page. An arrow function calling act() would not work: act does not exist
    // in the page, only here.
    const outcome = await page.evaluate(act, {
      decision,
      expectedName: seen.personName,
      forbiddenSource: FORBIDDEN.source,
      goal,
    });

    if (!outcome.ok) {
      // A refusal is worth recording in history: it stops the model proposing
      // the same disallowed thing on the next step.
      history.push(`refused: ${outcome.error}`);
      onStep({ step, refused: outcome.error });
      if (history.filter((h) => h.startsWith("refused")).length >= 3) {
        return { status: "failed", result: `stopped after three refused suggestions — last: ${outcome.error}` };
      }
    } else {
      history.push(outcome.did);
    }

    // Let the click land — a dialog opening, a menu expanding.
    await sleep(1400 + Math.random() * 900);
    const before = seen.elements.length;
    seen = await page.evaluate(observe);

    // A click that revealed nothing is the single most useful thing to feed
    // back. It is what happens when the wrong "More" is opened — a page has
    // several — and without being told, the model concludes there is no Connect
    // anywhere and gives up on a profile it could have handled.
    if (outcome.ok && seen.elements.length === before) {
      history.push("that revealed nothing new — it was probably the wrong element, try another");
    }
  }

  return {
    status: "failed",
    result: `did not finish within ${MAX_STEPS} steps. Last seen: ${describe(seen)}`,
  };
}

module.exports = { pilotAction, MAX_STEPS };
