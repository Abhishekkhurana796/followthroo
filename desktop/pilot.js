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
/** Ask for a screenshot once the element list alone has not got us there. */
const SCREENSHOT_AFTER_STEP = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // Let the profile settle. Everything after this is driven by what is actually
  // on the page, so this is the only fixed wait in the whole flow.
  await sleep(2500 + Math.random() * 2000);

  let seen = await page.evaluate(observe);

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

  for (let step = 0; step < MAX_STEPS; step++) {
    if (seen.limitWall) {
      return { status: "failed", result: seen.limitWall, fatal: "limit" };
    }

    const screenshot =
      step >= SCREENSHOT_AFTER_STEP
        ? (await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64")
        : null;

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

    onStep({ step, decision });

    if (decision.action === "give_up") {
      const why = String(decision.reason || "").toLowerCase();
      if (/already connected/.test(why)) {
        return { status: "skipped", result: "already connected — no invitation to send" };
      }
      return { status: "failed", result: `gave up: ${decision.reason}` };
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
    seen = await page.evaluate(observe);
  }

  return { status: "failed", result: `did not finish within ${MAX_STEPS} steps` };
}

module.exports = { pilotAction, MAX_STEPS };
