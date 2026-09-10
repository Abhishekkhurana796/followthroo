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
const { CODES } = require("./outcome-codes");

const MAX_STEPS = 8;
/**
 * Attach a screenshot to every step.
 *
 * It began at step four, which meant it never happened — the model gave up at
 * step zero or one, so the fallback meant to rescue a page the element list
 * could not describe was never reached. Then step one, which still missed the
 * first decision, the one that matters most.
 *
 * A label list flattens the page: two buttons both read "More", a Connect that
 * is visually obvious sits among thirty others, and "Follow" looks like an
 * action button because it is one. The picture disambiguates all of that, and at
 * Gemini Flash prices a downscaled JPEG per step is not worth optimising away.
 */
const SCREENSHOT_AFTER_STEP = 0;

/**
 * How many elements may go to the assistant.
 *
 * The endpoint refuses more than 200, and a rejected body reads to the client as
 * "could not reach the assistant" — so exceeding it silently sent every action
 * to the old selector path. The list arrives sorted with the dialog first, then
 * the profile's action row, so a trim takes from the least useful end.
 */
const MAX_ELEMENTS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page in one line, for a failure message somebody has to act on. */
function describe(seen) {
  if (!seen || !seen.elements) return "nothing";
  return seen.elements
    .slice(0, 14)
    .map((e) => (e.inTopCard ? `*${e.label}*` : e.label))
    .join(" | ");
}

/**
 * Ask the server, surviving a hiccup.
 *
 * One "fetch failed" used to drop the whole action to the old selector path —
 * which then reported that it could not find a Connect button, so a momentary
 * network blip read as a LinkedIn layout change. A home connection drops
 * packets; a run lasting half an hour will meet that.
 */
async function askServer(apiBase, token, observation, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${apiBase}/api/linkedin/assist`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(observation),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        // A rejected token or a missing model will not fix itself; only retry
        // what might.
        const retryable = res.status >= 500 || res.status === 429;
        last = new Error(json.error || `assist returned ${res.status}`);
        if (!retryable) throw last;
      } else {
        return json.data.decision;
      }
    } catch (e) {
      last = e;
    }
    if (i < attempts) await sleep(1200 * i);
  }
  throw last;
}

/**
 * Run one queued action to completion on an already-open profile page.
 *
 * Returns the same shape the selector path did — { status, result, fatal? } —
 * so the runner does not care which one produced it.
 */
async function pilotAction({ page, action, apiBase, token, onStep = () => {}, useNote = true }) {
  const goal = action.type === "message" ? "message" : "invite";
  // No note left in today's budget means no note on this one. An invitation
  // without one still arrives.
  const note = useNote ? action.note || null : null;
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
    return { status: "failed", code: CODES.LINKEDIN_SESSION_INVALID, result: "not logged in to LinkedIn in this browser", fatal: "login" };
  }

  // The identity guard, unchanged and non-negotiable: a renamed vanity URL or a
  // stale link can land on somebody else entirely.
  const wantSlug = (action.linkedinUrl || "").replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  const haveSlug = new URL(seen.url).pathname.replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  if (wantSlug && haveSlug && decodeURIComponent(wantSlug) !== decodeURIComponent(haveSlug)) {
    return {
      status: "failed",
      code: CODES.TARGET_PROFILE_MISMATCH,
      result: `landed on /in/${haveSlug} but this action is for /in/${wantSlug} — not acting on the wrong profile`,
    };
  }

  // Decided here rather than by the model: it is a fact on the page, and an
  // explicit invitation to an existing connection has nothing to do.
  if (goal === "invite" && seen.firstDegree) {
    return { status: "skipped", code: CODES.ALREADY_CONNECTED, result: "already connected — no invitation to send" };
  }

  // Somebody already invited them and it has not been accepted yet. Sending a
  // second one is not possible and would not be wanted.
  if (goal === "invite" && seen.pending) {
    return { status: "skipped", code: CODES.INVITATION_PENDING, result: "an invitation to this person is already pending" };
  }

  let sawScreenshot = false;
  let forceScreenshot = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    // If the browser was navigated away from the profile (e.g. into an activity post), return immediately
    const currentUrl = page.url();
    if (!currentUrl.includes("/in/")) {
      await page.goto(action.linkedinUrl, { waitUntil: "domcontentloaded" });
      await sleep(1500);
      seen = await page.evaluate(observe);
    }

    if (seen.limitWall) {
      return { status: "failed", code: CODES.LINKEDIN_LIMIT_REACHED, result: seen.limitWall, fatal: "limit" };
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
        useNote: !!(useNote && action.note),
        url: seen.url,
        step,
        history,
        elements: seen.elements.slice(0, MAX_ELEMENTS),
        screenshot,
        viewport: page.viewportSize() || (await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }))),
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      // The window was closed mid-run. Nothing else will work either, and
      // "could not reach the assistant" would send somebody looking at their
      // network for a browser that is no longer there.
      if (/Target page, context or browser has been closed|Target closed/i.test(msg)) {
        return { status: "failed", result: "the Chrome window was closed, so the run stopped", fatal: "closed" };
      }
      // A model that is down is not a profile without a Connect button, and the
      // run has to be able to tell those apart.
      return { status: "failed", result: `could not reach the assistant: ${msg}` };
    }

    // The elements go into the log too. A decision without the page it was made
    // from is not diagnosable — which is the whole reason this log exists.
    onStep({ step, decision, saw: seen.elements, personName: seen.personName });

    if (decision.action === "give_up") {
      const why = String(decision.reason || "").toLowerCase();
      if (/already connected/.test(why)) {
        return { status: "skipped", code: CODES.ALREADY_CONNECTED, result: "already connected — no invitation to send" };
      }
      // "No Connect button" is not a conclusion until the overflow menu has been
      // opened. On a follow-primary profile Connect is only in that menu, and
      // the model kept reading its absence from the card as "already connected"
      // — on 2nd-degree people, who are exactly the ones worth inviting.
      const openedMenu = history.some((h) => /clicked "(more|more actions)/i.test(h));
      if (goal === "invite" && !openedMenu && !/already connected/.test(why)) {
        history.push(
          "gave up without opening the profile's More menu — Connect is often only in there, so open it and look",
        );
        forceScreenshot = true;
        await sleep(600);
        seen = await page.evaluate(observe);
        continue;
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
      if (after.limitWall) return { status: "failed", code: CODES.LINKEDIN_LIMIT_REACHED, result: after.limitWall, fatal: "limit" };

      // "done" is a claim, not evidence. A model that answers done on the first
      // step without touching anything would otherwise be recorded as a sent
      // invitation — a lie in the CRM, and the sequence follows up on a
      // conversation that never started. Require that we actually clicked
      // something that invites.
      if (goal === "invite" && !history.some((h) => /clicked "(invite|connect|send)/i.test(h))) {
        return {
          status: "failed",
          code: CODES.INVITATION_SUBMISSION_UNCONFIRMED,
          result: "the assistant said it was done without ever clicking Connect — nothing was sent",
        };
      }

      if (goal === "invite" && after.dialogOpen) {
        return {
          status: "failed",
          code: CODES.INVITATION_SUBMISSION_UNCONFIRMED,
          result: "the assistant said it was done, but the invite dialog is still open — treating as not sent",
        };
      }
      if (!autoSend) {
        return { status: "drafted", code: null, result: "filled in and left for you to send", kind: goal };
      }
      return {
        status: "sent",
        code: CODES.INVITATION_SUBMITTED,
        result: goal === "invite" ? "invitation sent" : "message sent",
        kind: goal,
        // Only a note that was actually typed spends the day's allowance.
        noteUsed: history.some((h) => /^typed/.test(h)),
      };
    }

    // `act` is passed by reference so Playwright serializes its source into the
    // page. An arrow function calling act() would not work: act does not exist
    // in the page, only here.
    const outcome = await page.evaluate(act, {
      decision,
      expectedName: seen.personName,
      forbiddenSource: FORBIDDEN.source,
      goal,
      // Not advice. With this false, act() refuses anything that would send.
      autoSend,
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
      // Execute the click using Playwright's native trusted mouse input pipeline if not already clicked by rescue.
      if (outcome.action === "click") {
        let clicked = false;
        if (outcome.selector) {
          try {
            await page.click(outcome.selector, { timeout: 2000, noWaitAfter: true });
            clicked = true;
          } catch (_) {}
        }
        if (!clicked && outcome.point && typeof outcome.point.x === "number" && typeof outcome.point.y === "number") {
          try {
            await page.mouse.move(outcome.point.x, outcome.point.y);
            await sleep(40 + Math.random() * 40);
            await page.mouse.click(outcome.point.x, outcome.point.y);
            clicked = true;
          } catch (_) {}
        }
        await page.evaluate(() => {
          document.querySelectorAll("[data-ft-act]").forEach((e) => e.removeAttribute("data-ft-act"));
        }).catch(() => {});
      }

      history.push(outcome.did);
    }

    // Let the click land — a dialog opening, a menu expanding.
    await sleep(1400 + Math.random() * 800);
    // If a dialog or menu is opening, give it a moment to appear in the DOM
    for (let i = 0; i < 6; i++) {
      const appeared = await page
        .evaluate(() => !!document.querySelector('[role="dialog"], .artdeco-modal, .artdeco-dropdown__content, [role="menu"]'))
        .catch(() => false);
      if (appeared) break;
      await sleep(250);
    }

    // Check if invitation sent toast appeared or pending status confirmed
    const hasSentToast = await page
      .locator('.artdeco-toast-item, div[role="alert"], [data-view-name*="toast"]')
      .filter({ hasText: /invitation sent|invite sent/i })
      .isVisible({ timeout: 800 })
      .catch(() => false);

    const now = await page.evaluate(observe);
    if (
      goal === "invite" &&
      autoSend &&
      (now.pending || hasSentToast) &&
      history.some((h) => /clicked "(invite|connect|send)/i.test(h))
    ) {
      return {
        status: "sent",
        code: CODES.INVITATION_SUBMITTED,
        result: "invitation sent",
        kind: "invite",
        noteUsed: history.some((h) => /^typed/.test(h)),
      };
    }
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
