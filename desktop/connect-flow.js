/**
 * The deterministic connection driver.
 *
 * `observe()` in pilot-page.js already works out which "Connect" belongs to the
 * profile being visited — that is the hard part, and it is done from the page's
 * own evidence (the top card, the section heading, geometry), not from a model's
 * reading of a screenshot. Once that attribution exists, choosing what to click
 * is not a judgement call: it is the profile's own Connect, then the note, then
 * Send. So this drives that sequence directly and only asks the model when the
 * page is one it cannot recognise at all.
 *
 * Two things are non-negotiable, and neither is relaxed here:
 *
 *   1. Every click still goes through `act()`. This file decides *which* element
 *      is the target; `act()` still refuses the sidebar, another person's card,
 *      a destructive label, a Send during a test run, and Follow when the goal is
 *      to connect. The driver cannot talk its way past any of those.
 *   2. "Sent" means the page confirmed it. Clicking Send is not evidence; the
 *      button turning to "Pending" or a "sent" toast is. Absent that, the outcome
 *      is INVITATION_SUBMISSION_UNCONFIRMED, never a reported send.
 *
 * The model (pilotAction) remains as `fallback` for layouts the deterministic
 * path does not recognise — but only *before* anything has been clicked, so a
 * hand-off can never turn into a second invitation.
 */
const { observe, act, FORBIDDEN } = require("./pilot-page");
const { CODES } = require("./outcome-codes");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A Connect control, by its exact words. Not "Follow", not "Message". */
const CONNECT_RE = /^connect$|^invite\b.*\bto connect$/i;
const MORE_RE = /^more\b|more actions/i;

/**
 * Run one decision through `act()`, then land the click with a trusted input.
 *
 * `act()` dispatches synthetic events in the page and reports a selector/point;
 * the real, trusted click is issued here through Playwright, exactly as the model
 * loop does. Type actions are reinforced with a Playwright `fill` because setting
 * `.value` in-page does not reliably update a React-controlled textarea — which
 * is how a note could read as typed and arrive empty.
 */
async function runAct(page, decision, seen, { goal, autoSend }) {
  const outcome = await page.evaluate(act, {
    decision,
    expectedName: seen.personName,
    forbiddenSource: FORBIDDEN.source,
    goal,
    autoSend,
  });

  if (outcome.ok && decision.action === "type") {
    try {
      const ta = page
        .locator(
          '[role="dialog"] textarea, .artdeco-modal textarea, textarea#custom-message, [role="dialog"] [contenteditable="true"]',
        )
        .first();
      if (await ta.isVisible({ timeout: 800 }).catch(() => false)) {
        await ta.fill(String(decision.text ?? ""));
      }
    } catch (_) {}
    return outcome;
  }

  if (outcome.ok && outcome.action === "click") {
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
      } catch (_) {}
    }
    await page
      .evaluate(() => {
        document.querySelectorAll("[data-ft-act]").forEach((e) => e.removeAttribute("data-ft-act"));
      })
      .catch(() => {});
  }

  return outcome;
}

/** Re-read the page until a condition holds or the tries run out. */
async function observeUntil(page, ok, tries = 6, gap = 400) {
  let seen = await page.evaluate(observe);
  for (let i = 0; i < tries && !ok(seen); i++) {
    await sleep(gap);
    seen = await page.evaluate(observe);
  }
  return seen;
}

/**
 * Send one connection request to an already-open profile page, deterministically.
 *
 * Returns { status, code, result, kind?, fatal?, noteUsed? }. `status` is the
 * queue's existing vocabulary (sent/failed/skipped/drafted); `code` is the
 * machine-readable reason from outcome-codes.js. Shape matches pilotAction so the
 * runner does not care which produced it.
 */
async function sendConnectionRequest({ page, action, onStep = () => {}, useNote = true, fallback = null }) {
  const goal = "invite";
  const note = useNote ? action.note || null : null;
  const autoSend = action.autoSend === true;
  const history = [];
  let stepNo = 0;
  const logStep = (extra) => {
    onStep({ step: stepNo++, ...extra });
  };

  const fail = (code, result, extra = {}) => ({ status: "failed", code, result, kind: goal, ...extra });
  const skip = (code, result) => ({ status: "skipped", code, result, kind: goal });

  // A hand-off is only safe before anything has been clicked: the model loop
  // re-drives the page from scratch, and doing that after a Connect click could
  // send a second invitation. Callers only reach `delegate` from the pre-click
  // branches below.
  const delegate = async (code, result) => {
    if (typeof fallback === "function") {
      const out = await fallback();
      return { ...out, code: out.code || CODES.DELEGATED_TO_MODEL, delegated: true };
    }
    return fail(code, result);
  };

  // 1. The profile has to actually be on screen — the navbar hydrates first.
  await sleep(1500 + Math.random() * 1000);
  let seen = await observeUntil(page, (s) => s.profileReady || s.signedOut, 12, 1000);

  if (seen.signedOut) {
    return fail(CODES.LINKEDIN_SESSION_INVALID, "not logged in to LinkedIn in this browser", { fatal: "login" });
  }

  // 2. Right person. A renamed vanity URL or a stale link lands on someone else.
  const wantSlug = (action.linkedinUrl || "").replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  const haveSlug = new URL(seen.url).pathname.replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  if (wantSlug && haveSlug && decodeURIComponent(wantSlug) !== decodeURIComponent(haveSlug)) {
    return fail(
      CODES.TARGET_PROFILE_MISMATCH,
      `landed on /in/${haveSlug} but this action is for /in/${wantSlug} — not acting on the wrong profile`,
    );
  }

  // 3. Facts the page states outright.
  if (seen.limitWall) return fail(CODES.LINKEDIN_LIMIT_REACHED, seen.limitWall, { fatal: "limit" });
  if (seen.firstDegree) return skip(CODES.ALREADY_CONNECTED, "already connected — no invitation to send");
  if (seen.pending) return skip(CODES.INVITATION_PENDING, "an invitation to this person is already pending");

  // 4. Resolve Connect from attribution, never from a bare text search.
  //
  // `ownStrong` — inside the top card, or under the owner's own name heading —
  // is what we act on. `inTopCard` also folds in geometry, which on a short page
  // will claim the sticky action bar that rides at the top; using it here would
  // reintroduce exactly the "two Connects both look owned" ambiguity.
  const connectCandidates = seen.elements.filter((e) => CONNECT_RE.test(e.label.trim()) && !e.inAside);
  const attributed = connectCandidates.filter((e) => e.ownStrong);

  if (attributed.length > 1) {
    return fail(
      CODES.CONNECT_BUTTON_AMBIGUOUS,
      `${attributed.length} Connect buttons are both attributed to ${seen.personName || "this profile"} — refusing to guess`,
    );
  }

  if (attributed.length === 0) {
    if (connectCandidates.length > 0) {
      // There are Connect buttons, but none can be tied to this profile. This is
      // the case the whole safety story exists for — refuse rather than pick one.
      const where = connectCandidates.map((e) => e.i).join(", ");
      return fail(
        CODES.CONNECT_BUTTON_AMBIGUOUS,
        `Connect appears in ${connectCandidates.length} places (elements ${where}) and none is this profile's own — refusing to guess whose it is`,
      );
    }

    // No Connect on the card at all. It may be inside the profile's own More
    // menu (follow-primary profiles), or the layout may be one we do not know.
    const more = seen.elements.find((e) => e.ownStrong && MORE_RE.test(e.label.trim()));
    if (!more) {
      if (seen.profileReady) {
        // We can see the action row and it has neither Connect nor More — a
        // follow-only or restricted profile. Following is not connecting.
        return fail(
          CODES.CONNECT_BUTTON_NOT_FOUND,
          `${seen.personName || "this profile"} has no Connect and no More in its action row — not following instead`,
        );
      }
      return delegate(CODES.CONNECT_BUTTON_NOT_FOUND, "could not identify the profile's action row");
    }

    // Open the profile's OWN More, then look again. `act` clicks only the
    // attributed More (by index), and resolveByText("Connect") afterwards
    // excludes the sidebar and recommendation cards, so the menu item is the
    // only candidate left.
    const openMore = await runAct(page, { action: "click", index: more.i, reason: "open the profile's More menu" }, seen, {
      goal,
      autoSend,
    });
    logStep({ decision: { action: "click", index: more.i, reason: "open More" }, saw: seen.elements, personName: seen.personName });
    if (!openMore.ok) return fail(CODES.CONNECT_BUTTON_NOT_FOUND, `could not open the More menu: ${openMore.error}`);
    history.push(openMore.did);

    await sleep(1000);
    // The menu item's accessible name is "Invite <name> to connect", not the
    // bare word "Connect", and the page still carries strangers' "Connect"
    // buttons — so resolve it by attribution and index, not by the literal word.
    // The strangers are in the sidebar or under a recommendation heading
    // (inAside), so a Connect-shaped label that is not inAside is the menu item
    // the profile's own More just revealed.
    seen = await observeUntil(
      page,
      (s) => s.elements.some((e) => CONNECT_RE.test(e.label.trim()) && !e.inAside),
      8,
      300,
    );
    const menuConnects = seen.elements.filter((e) => CONNECT_RE.test(e.label.trim()) && !e.inAside);
    if (menuConnects.length === 0) {
      return fail(CODES.CONNECT_BUTTON_NOT_FOUND, `opened ${seen.personName || "the profile"}'s More menu but it holds no Connect — not following instead`);
    }
    if (menuConnects.length > 1) {
      return fail(CODES.CONNECT_BUTTON_AMBIGUOUS, `the More menu offered ${menuConnects.length} Connect-like items — refusing to guess`);
    }
    const inMenu = await runAct(page, { action: "click", index: menuConnects[0].i, reason: "click Connect in the More menu" }, seen, {
      goal,
      autoSend,
    });
    logStep({ decision: { action: "click", index: menuConnects[0].i, reason: "Connect in More" }, saw: seen.elements, personName: seen.personName });
    if (!inMenu.ok) return fail(CODES.CONNECT_BUTTON_NOT_FOUND, `Connect in ${seen.personName || "the profile"}'s More menu was refused: ${inMenu.error}`);
    history.push(inMenu.did);
  } else {
    // Exactly one attributed Connect. Click it by index — the strongest handle.
    const c = attributed[0];
    const clickConnect = await runAct(page, { action: "click", index: c.i, reason: "click the profile's own Connect" }, seen, {
      goal,
      autoSend,
    });
    logStep({ decision: { action: "click", index: c.i, reason: "Connect" }, saw: seen.elements, personName: seen.personName });
    // A refusal here is a safety signal (name mismatch, sidebar, forbidden), not
    // a layout we should hand to the model — stop.
    if (!clickConnect.ok) return fail(CODES.CONNECT_BUTTON_NOT_FOUND, `Connect click refused: ${clickConnect.error}`);
    history.push(clickConnect.did);
  }

  // 5. Clicking Connect either opens the note/send dialog or, on some layouts,
  // sends immediately and flips the button to Pending.
  await sleep(1400 + Math.random() * 600);
  seen = await observeUntil(page, (s) => s.dialogOpen || s.pending || s.limitWall, 8, 400);

  // The weekly-limit wall arrives as the dialog: a modal where the compose form
  // should be. Every remaining action would meet the same wall, so this ends the
  // batch rather than reading as one profile that happened to have no Send.
  if (seen.limitWall) return fail(CODES.LINKEDIN_LIMIT_REACHED, seen.limitWall, { fatal: "limit" });

  if (seen.pending) {
    return {
      status: "sent",
      code: CODES.INVITATION_SUBMITTED,
      result: "invitation sent",
      kind: "invite",
      noteUsed: false,
    };
  }

  if (!seen.dialogOpen) {
    return fail(CODES.INVITATION_DIALOG_NOT_FOUND, "clicked Connect but no invitation dialog appeared — treating as not sent");
  }

  // Dialog controls are resolved by index from the observed element list, not by
  // their words. LinkedIn's modal is a div whose textContent contains "Send
  // without a note" and "Add a note", so a text search lands on the container,
  // not the button — clicking a dead div and leaving the dialog untouched. The
  // element list already carries each button with its own label and inDialog.
  const dialogButton = (s, re) =>
    s.elements.find((e) => e.inDialog && re.test(e.label.trim()));

  // 6. The note, if today's budget allows one and the campaign supplied one.
  let noteTyped = false;
  if (note) {
    const addNote = dialogButton(seen, /^add a note$/i);
    if (addNote) {
      const clicked = await runAct(page, { action: "click", index: addNote.i, reason: "add a note" }, seen, { goal, autoSend });
      logStep({ decision: { action: "click", index: addNote.i, reason: "add a note" }, saw: seen.elements, personName: seen.personName });
      if (clicked.ok) {
        history.push(clicked.did);
        await sleep(700);
        seen = await observeUntil(page, (s) => s.elements.some((e) => e.inDialog && (e.tag === "textarea" || e.tag === "input")), 6, 300);
        const field = seen.elements.find((e) => e.inDialog && (e.tag === "textarea" || e.tag === "input"));
        if (!field) return fail(CODES.MESSAGE_FIELD_NOT_FOUND, "the invitation dialog opened but no note field appeared");
        const typed = await runAct(page, { action: "type", index: field.i, text: note, reason: "type the note" }, seen, { goal, autoSend });
        logStep({ decision: { action: "type", index: field.i, reason: "note" }, saw: seen.elements, personName: seen.personName });
        if (!typed.ok) return fail(CODES.MESSAGE_FIELD_NOT_FOUND, `could not type the note: ${typed.error}`);
        history.push(typed.did);
        noteTyped = true;
        await sleep(400);
      }
    }
    // If "Add a note" is not offered, fall through to a plain send.
  }

  // 7. A test run stops here, filled but unsent — the same contract the model
  // path honours, and `act` would refuse the Send below anyway.
  if (!autoSend) {
    return { status: "drafted", code: null, result: "filled in and left for you to send", kind: goal };
  }

  // 8. Send. With a note typed the button reads "Send"; without, LinkedIn offers
  // "Send without a note". Pick the dialog's own Send control by index.
  seen = await page.evaluate(observe);
  const dialogSends = seen.elements.filter((e) => e.inDialog && /^send\b/i.test(e.label.trim()));
  const sendEl = noteTyped
    ? dialogSends.find((e) => !/without a note/i.test(e.label)) || dialogSends[0]
    : dialogSends.find((e) => /without a note/i.test(e.label)) || dialogSends[0];
  if (!sendEl) {
    return fail(CODES.SEND_BUTTON_NOT_FOUND, "the invitation dialog is open but Send could not be found");
  }
  const sent = await runAct(page, { action: "click", index: sendEl.i, reason: "send the invitation" }, seen, { goal, autoSend });
  logStep({ decision: { action: "click", index: sendEl.i, reason: "send" }, saw: seen.elements, personName: seen.personName });
  if (!sent.ok) {
    return fail(CODES.SEND_BUTTON_NOT_FOUND, `the Send control was refused: ${sent.error}`);
  }
  history.push(sent.did);

  // 9. Proof. The button turning to Pending, or a "sent" toast, is the page
  // confirming the invitation went. Anything less is not a send.
  await sleep(1400 + Math.random() * 600);
  const after = await observeUntil(page, (s) => s.pending || s.limitWall, 6, 400);
  const toast = await page
    .locator('.artdeco-toast-item, div[role="alert"], [data-view-name*="toast"]')
    .filter({ hasText: /invitation sent|invite sent/i })
    .isVisible({ timeout: 600 })
    .catch(() => false);

  if (after.limitWall) return fail(CODES.LINKEDIN_LIMIT_REACHED, after.limitWall, { fatal: "limit" });

  if (after.pending || toast) {
    return {
      status: "sent",
      code: CODES.INVITATION_SUBMITTED,
      result: "invitation sent",
      kind: "invite",
      noteUsed: noteTyped,
    };
  }

  return {
    status: "failed",
    code: CODES.INVITATION_SUBMISSION_UNCONFIRMED,
    result: "clicked Send but the page did not confirm the invitation (no Pending, no toast) — treating as not sent",
    kind: goal,
  };
}

module.exports = { sendConnectionRequest, CONNECT_RE, MORE_RE };
