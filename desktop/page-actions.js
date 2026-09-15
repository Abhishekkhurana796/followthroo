/**
 * What actually happens on a LinkedIn page: fill the invite note or the message
 * box, and — when autoSend is on — click Send and confirm it went.
 *
 * This function used to live inside extension/background.js, where the Chrome
 * service worker injected it with chrome.scripting.executeScript. The desktop
 * app drives the same DOM with Playwright instead, and the verification script
 * drives it against a fixture. Three callers, one implementation: a selector
 * fix has to land in exactly one place, and the thing the tests exercise is the
 * thing that ships.
 *
 * It runs INSIDE the page, so it must stay self-contained — no imports, no
 * closure over anything in this module. Playwright serializes it by source.
 *
 * Best-effort DOM automation. LinkedIn changes its markup often, so selectors
 * are defensive and every path returns a stated outcome rather than throwing.
 */
async function fillLinkedInAction(action) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * The profile's OWN action area, never the whole page.
   *
   * A LinkedIn profile carries other people's Connect buttons: "People also
   * viewed" and "More profiles for you" each render a card per person, with a
   * working Connect on it. Searching the whole document for /^Connect/ therefore
   * finds a stranger from the sidebar as readily as the person you meant, and
   * clicking it sends a real invitation to somebody you never selected.
   *
   * That is not a cosmetic bug — it is worse than sending nothing — so the
   * search is anchored to the section containing the profile's <h1>, falls back
   * to <main>, and never reaches <aside>.
   */
  const scope = () => {
    const h1 = document.querySelector("main h1, h1");
    const card = h1 && (h1.closest("section") || h1.closest("div.ph5") || h1.parentElement);
    return card || document.querySelector("main") || document.body;
  };
  const inScope = (el) => {
    if (!el) return false;
    if (el.closest("aside")) return false; // recommendation rails live here
    if (el.closest("[data-followthroo-overlay]")) return false; // our own do-not-touch banner
    return scope().contains(el) || (document.querySelector("main")?.contains(el) && !el.closest("aside"));
  };
  /**
   * Everything LinkedIn treats as a button.
   *
   * `div[role="button"]` is the one that matters and the one that was missing.
   * The Connect action is not a <button> when it lives in the overflow menu —
   * it is a div with a role, inside .artdeco-dropdown__content. Searching only
   * `button, a[role="button"]` therefore found nothing after opening the menu,
   * which is exactly the reported symptom: the three dots open and nothing else
   * happens.
   */
  const CLICKABLE =
    'button, a[role="button"], div[role="button"], [role="menuitem"], .artdeco-dropdown__item';
  const all = (sel) => Array.from(scope().querySelectorAll(sel));
  const label = (b) => ((b.getAttribute("aria-label") || b.textContent || "").trim());
  const btnByLabel = (re) => all(CLICKABLE).find((b) => re.test(label(b)) && inScope(b));

  // Bail early if LinkedIn bounced us to a login/checkpoint page.
  if (/\/(login|checkpoint|authwall)/.test(location.pathname) || document.querySelector('input[name="session_key"]')) {
    return { status: "failed", result: "not logged in to LinkedIn in this browser", fatal: "login" };
  }

  /**
   * Are we actually on the person we were asked to contact?
   *
   * LinkedIn redirects: a renamed vanity URL, a members-only profile, or a stale
   * link can land on someone else entirely. Combined with the sidebar problem
   * above, "invite whoever is on screen" is how the wrong person gets a
   * connection request — and an invitation cannot be quietly taken back.
   */
  const wantSlug = (action.linkedinUrl || "").replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  const haveSlug = location.pathname.replace(/\/+$/, "").split("/in/")[1]?.split(/[?#/]/)[0];
  if (wantSlug && haveSlug && decodeURIComponent(wantSlug) !== decodeURIComponent(haveSlug)) {
    return {
      status: "failed",
      result: `landed on /in/${haveSlug} but this action is for /in/${wantSlug} — not acting on the wrong profile`,
    };
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

  /**
   * Positive evidence that this person is ALREADY a connection.
   *
   * Without this, "already connected" and "I could not find the Connect button"
   * are the same observation — no Connect on the page — and the old code
   * resolved both by sending a message. So a selector miss quietly sent a DM to
   * someone who was supposed to get a connection request. Requiring evidence is
   * what lets the two be told apart and handled differently.
   */
  const isFirstDegree = () => {
    const badge = scope().querySelector(".dist-value, .distance-badge, .pv-member-badge");
    if (badge && /1st/i.test(badge.textContent || "")) return true;
    // "Remove Connection" only ever appears for someone you are connected to.
    return all(CLICKABLE).some((b) => /remove connection/i.test(label(b)));
  };

  /**
   * Open the overflow ("More") menu and return the container that appeared.
   *
   * LinkedIn renders the open dropdown outside the profile card — often at
   * document level — so the profile-scoped helpers do not reach it and a
   * document-wide search is required here. It is still filtered against the
   * sidebar and our own banner by the caller.
   */
  async function openMoreMenu() {
    const more = btnByLabel(/^More\b/i) || btnByLabel(/more actions/i);
    if (!more) return null;
    const before = new Set(document.querySelectorAll('.artdeco-dropdown__content, [role="menu"]'));
    more.click();

    // Wait for the menu rather than guessing at a fixed delay — the old fixed
    // 1200ms was both too long when it worked and too short when the page was
    // busy.
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const menus = Array.from(document.querySelectorAll('.artdeco-dropdown__content, [role="menu"]'));
      const appeared = menus.find((m) => !before.has(m) && m.offsetParent !== null);
      if (appeared) return appeared;
      if (more.getAttribute("aria-expanded") === "true" && menus.length) {
        return menus[menus.length - 1];
      }
    }
    return null;
  }

  /**
   * The Connect control for THIS profile, wherever LinkedIn is hiding it today:
   * on the top card, or behind the overflow menu.
   *
   * The same pattern is used in both places — /^(Connect|Invite)\b/ — because in
   * the menu the accessible name is "Invite <Name> to connect". The old retry
   * narrowed to /^Connect\b/ and so could not match the very thing it had just
   * opened the menu to find.
   */
  const CONNECT_RE = /^(Connect|Invite)\b/i;

  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  /**
   * The profile owner's name, from the <h1>.
   *
   * This is what makes targeting reliable. LinkedIn writes the person's name
   * into the button — "Invite Sofia Haltrup to connect" — so matching on the
   * name identifies the right button wherever it happens to sit in the DOM,
   * and simultaneously rules out the Connect buttons belonging to strangers in
   * "More profiles for you", whose labels carry *their* names.
   *
   * Anchoring to structure instead was the mistake: `scope()` walks up from the
   * <h1> to a section, and when LinkedIn's markup does not put the action row
   * inside that same element the visible Connect button becomes invisible to
   * the search. Which is exactly what happened — it opened the overflow menu
   * looking for a button that was on screen the whole time.
   */
  const profileName = () => {
    const h1 = document.querySelector("main h1, h1");
    // First line only: the heading can carry a verified badge or pronouns.
    return norm((h1?.textContent || "").split("\n")[0]);
  };

  /** Clickables anywhere in the page that we are permitted to consider. */
  const candidates = () => {
    const main = document.querySelector("main") || document.body;
    return Array.from(main.querySelectorAll(CLICKABLE)).filter(
      (b) => !b.closest("aside") && !b.closest("[data-followthroo-overlay]"),
    );
  };

  const isConnectLabel = (l) => /invite\b[\s\S]*\bto connect\b/i.test(l) || CONNECT_RE.test(l);

  async function findConnect() {
    const name = profileName();

    // 1. By name. The strongest signal, and immune to how the page is nested.
    if (name) {
      const byName = candidates().find((b) => {
        const l = label(b);
        return /invite\b[\s\S]*\bto connect\b/i.test(l) && norm(l).includes(name);
      });
      if (byName) return byName;
    }

    // 2. Within the profile's own card, by label. Covers a button whose
    //    accessible name omits the person (rarer, but it happens).
    const scoped = btnByLabel(CONNECT_RE);
    if (scoped) return scoped;

    // 3. Behind the overflow menu, which is where LinkedIn puts it on plenty of
    //    profiles.
    const menu = await openMoreMenu();
    if (!menu) return null;
    const inMenu = Array.from(menu.querySelectorAll(CLICKABLE)).find((b) => {
      if (b.closest("aside") || b.closest("[data-followthroo-overlay]")) return false;
      const l = label(b);
      // "Connect" must not match "Remove Connection", and the menu also offers
      // Follow / Save to PDF / Report, which a looser match would happily click.
      return isConnectLabel(l) && !/remove connection/i.test(l);
    });

    // Leave the page as we found it. An overflow menu hanging open is how the
    // last failure looked to the person watching: something clearly happened,
    // and then nothing.
    if (!inMenu) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.querySelector("main")?.click?.();
    }
    return inMenu;
  }

  /**
   * What we could see, for when we could not see Connect.
   *
   * A failure that says only "could not find a Connect button" is unactionable
   * — the next person has to reproduce it against a live profile to learn
   * anything. Listing the buttons that were actually on the page turns one
   * report into a fix.
   */
  const visibleActions = () =>
    candidates()
      .map((b) => label(b))
      .filter((l) => l && l.length < 60)
      .slice(0, 12)
      .join(" | ");

  /**
   * LinkedIn's own ceiling, hit mid-run.
   *
   * "You've reached the weekly invitation limit" is not a failure of this
   * action — it is a statement about the account, and every remaining action
   * would hit it too. Reported as fatal so the runner stops the batch instead
   * of grinding through nineteen more and drawing more attention to an account
   * that is already being told no.
   */
  const limitWall = () => {
    const dlg = openModal();
    const text = ((dlg && dlg.textContent) || "").toLowerCase();
    if (/weekly invitation limit|reached the weekly|try again next week/.test(text)) {
      return "LinkedIn says this account has hit its weekly invitation limit";
    }
    if (/restricted|unusual activity|verify your identity/.test(text)) {
      return "LinkedIn is showing a restriction or verification prompt";
    }
    return null;
  };

  const MSG_BOX =
    '.msg-form__contenteditable[contenteditable="true"], .msg-form__contenteditable, div[role="textbox"][contenteditable="true"]';
  const msgBoxes = () => Array.from(document.querySelectorAll(MSG_BOX));

  async function fillMessage() {
    const mb = messageBtn || btnByLabel(/^Message\b/i);
    if (!mb) return { status: "skipped", result: "no Message button" };

    // Which windows were already open BEFORE we asked for this one. LinkedIn
    // keeps previous conversations docked along the bottom of the screen, and
    // taking the first message box in the document means typing this person's
    // message into whoever was open already — and then sending it to them.
    const before = new Set(msgBoxes());
    mb.click();
    await sleep(2800);

    const box =
      // The window that appeared because we clicked Message.
      msgBoxes().find((b) => !before.has(b)) ||
      // Already open, so nothing is new: trust the one LinkedIn focused, and
      // failing that the most recently docked, never the oldest.
      (document.activeElement && document.activeElement.closest?.(MSG_BOX)) ||
      msgBoxes().at(-1);
    if (!box) return { status: "failed", result: "message box not found" };
    box.focus();
    const text = raw || "Hi!";
    // execCommand is the only focus-dependent step in this whole file, and it
    // returns false rather than throwing when the document does not have focus
    // — which is the normal state while someone carries on using their computer
    // in another window. The fallback writes the text directly, the same way the
    // invite note is set below.
    const typed = document.execCommand("insertText", false, text);
    if (!typed || !(box.textContent || "").trim()) {
      box.textContent = text;
      box.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
    if (!autoSend) {
      return { status: "drafted", result: "message drafted — review it and click Send yourself", kind: "message" };
    }

    // Send within the form we just typed into. LinkedIn allows several message
    // windows open at once, so a document-wide search for the send button can
    // fire in a different conversation entirely — sending this person's message
    // to whoever else happened to be open.
    const form = box.closest("form") || box.closest(".msg-form") || box.parentElement;
    const within = form || document;

    await sleep(600 + Math.random() * 700);
    const send =
      within.querySelector("button.msg-form__send-button:not([disabled])") ||
      Array.from(within.querySelectorAll('button, a[role="button"]')).find(
        (b) => /^send$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()) && !b.disabled,
      );
    if (!send) return { status: "failed", result: "auto-send on, but no enabled Send button in the message form" };
    send.click();

    // Confirm rather than assume. A click that did nothing must not be recorded
    // as a sent message — the CRM would claim contact that never happened, and
    // the sequence would move on to a follow-up.
    await sleep(1800);
    const cleared = !(box.textContent || "").trim();
    return cleared
      ? { status: "sent", result: "message sent", kind: "message" }
      : { status: "failed", result: "clicked Send but the message box still has text — treating as not sent", kind: "message" };
  }

  async function fillInvite() {
    const connect = await findConnect();
    if (!connect) return null; // not invitable from here — the caller decides why
    connect.click();
    await sleep(2200);

    // From here on the work happens inside the dialog LinkedIn just opened, which
    // is appended at document level rather than inside the profile card — so the
    // profile-scoped helpers above do not apply and would find nothing.
    const dlg = openModal();
    if (!dlg) return { status: "failed", result: "clicked Connect but no invite dialog appeared", kind: "invite" };

    const wall = limitWall();
    if (wall) return { status: "failed", result: wall, kind: "invite", fatal: "limit" };

    const addNote = Array.from(dlg.querySelectorAll("button")).find((b) =>
      /add a note/i.test((b.getAttribute("aria-label") || b.textContent || "")),
    );
    if (inviteNote && addNote) {
      addNote.click();
      await sleep(1200);
      const ta = dlg.querySelector('textarea#custom-message, textarea[name="message"], textarea');
      if (ta) { ta.focus(); ta.value = inviteNote; ta.dispatchEvent(new Event("input", { bubbles: true })); }
      // A Premium upsell where the note box should be: today's notes are gone.
      // Sending without the note would ignore the choice made for this person,
      // so close it and leave the invitation for tomorrow (see NOTE_LIMIT_REACHED).
      const shown = ((openModal() || dlg).textContent || "").toLowerCase();
      if (!ta && (/personali[sz]ed invitations?|free personali[sz]ed/.test(shown) || (/premium/.test(shown) && /invit/.test(shown)))) {
        const dismiss = document.querySelector('button[aria-label="Dismiss"], button[aria-label*="close" i]');
        if (dismiss) dismiss.click();
        return { status: "skipped", code: "NOTE_LIMIT_REACHED", result: "LinkedIn says today's personalised notes are used up — this invitation waits for tomorrow", kind: "invite" };
      }
    }
    if (!autoSend) {
      return { status: "drafted", result: "invitation drafted — review it and click Send yourself", kind: "invite" };
    }

    await sleep(700 + Math.random() * 900);
    const live = openModal() || dlg;
    const send =
      live.querySelector('button[aria-label="Send now"]:not([disabled]), button[aria-label*="Send invitation"]:not([disabled])') ||
      Array.from(live.querySelectorAll("button")).find(
        (b) => /^send( now| invitation)?$/i.test(((b.getAttribute("aria-label") || b.textContent || "").trim())) && !b.disabled,
      );
    if (!send) return { status: "failed", result: "auto-send on, but no enabled Send button in the invite dialog", kind: "invite" };
    send.click();

    // The dialog closing is the only evidence the invitation actually went.
    await sleep(2000);
    if (!openModal()) return { status: "sent", result: "invitation sent", kind: "invite" };
    const after = limitWall();
    if (after) return { status: "failed", result: after, kind: "invite", fatal: "limit" };
    return { status: "failed", result: "clicked Send but the invite dialog is still open — treating as not sent", kind: "invite" };
  }

  try {
    if (pending) return { status: "skipped", result: "invite already pending" };
    if (action.type === "message") return await fillMessage();

    const invited = await fillInvite();
    if (invited) return invited;

    // No Connect anywhere — on the card or behind the overflow menu. Two very
    // different situations look identical at this point, so decide on evidence
    // rather than on the absence of a button.
    const connected = isFirstDegree();

    if (connected) {
      // An explicit invite has nothing to do here. Messaging them instead would
      // send a connection-request note as a direct message to someone already
      // connected — not what was asked for, and not recallable.
      if (action.type === "invite") {
        return { status: "skipped", result: "already connected — no invitation to send" };
      }
      return await fillMessage(); // "auto" means: invite if you can, otherwise message
    }

    // Not connected, and yet no Connect button. That is a selector miss, which
    // means LinkedIn changed its markup — reported as failed so three in a row
    // stop the run, instead of quietly skipping twenty people in a row and
    // looking like an empty queue.
    return {
      status: "failed",
      result:
        "could not find a Connect button, and this profile is not shown as a connection — LinkedIn may have changed its layout. Buttons seen: " +
        (visibleActions() || "none"),
    };
  } catch (e) {
    return { status: "failed", result: String((e && e.message) || e) };
  }
}

/**
 * The people on your own Connections page, newest first, as profile URLs.
 *
 * LinkedIn announces an accepted invitation nowhere — no API, no notification
 * we can read. Your connections list is the evidence, so the desktop app reads
 * its first screen at the start of a run and tells Followthroo who is on it
 * (/api/linkedin/connections/seen), which marks those invitations accepted.
 *
 * Runs INSIDE the page, like fillLinkedInAction: no imports, no closure. Reads
 * hrefs only — never clicks — and returns [] rather than throwing when the markup
 * is not what it expects, because a run must never stop over a report.
 */
function readRecentConnections() {
  const scope = document.querySelector("main") || document.body;
  const slugOf = (a) => {
    try {
      const path = new URL(a.getAttribute("href"), "https://www.linkedin.com").pathname;
      return (path.split("/in/")[1] || "").split("/")[0] || null;
    } catch {
      return null;
    }
  };

  const found = new Set();
  for (const a of scope.querySelectorAll('a[href*="/in/"]')) {
    const slug = slugOf(a);
    if (!slug || found.has(slug)) continue;
    // Only a card that says "Connected …" counts. The page can also show people
    // you are not connected to, and one of them may have an invitation pending —
    // counting them would record an acceptance that never happened.
    let node = a;
    for (let depth = 0; depth < 6 && node && node !== scope; depth++) {
      node = node.parentElement;
      if (!node) break;
      const slugs = new Set(Array.from(node.querySelectorAll('a[href*="/in/"]')).map(slugOf).filter(Boolean));
      if (slugs.size > 1) break; // climbed past this person's own card
      // No word boundary before "connected": textContent runs adjacent elements
      // together, so a rendered card reads "Priya ShahConnected on 8 Sep" and
      // \bconnected never matched a real one. ("Connect", on a suggestion, is
      // not "connected".)
      if (/connected\b/i.test(node.textContent || "")) {
        found.add(slug);
        break;
      }
    }
  }
  return Array.from(found)
    .slice(0, 200)
    .map((slug) => `https://www.linkedin.com/in/${slug}`);
}

/**
 * Read a 1st-degree connection's Contact info: email, phone, websites, and
 * when they connected. Only ever called on a profile already confirmed
 * 1st-degree — LinkedIn shows nothing on Contact info for anyone else, and
 * this function does not itself decide who is eligible (see isFirstDegree
 * inside fillLinkedInAction, and connect-flow.js's observe()-based check,
 * which enrich-flow.js uses the same way before calling this).
 *
 * UNVERIFIED AGAINST A LIVE ACCOUNT. Written from LinkedIn's documented
 * Contact info overlay markup (the `.pv-contact-info` modal, `.ci-email` /
 * `.ci-phone` / `.ci-websites` / `.ci-connected` rows) the same way every
 * other selector in this file started — as a best guess to be corrected here,
 * in one place, the first time it's run against a real profile. If the
 * overlay never opens, the likely cause is the trigger link's selector below
 * having changed; check that first.
 *
 * Runs INSIDE the page: no imports, no closure over anything in this module.
 * Never throws — every path returns a stated outcome, and the overlay is
 * always closed again before returning, so a failed lookup does not leave a
 * modal open over the next thing this run does.
 */
async function readContactInfo(options = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (/\/(login|checkpoint|authwall)/.test(location.pathname) || document.querySelector('input[name="session_key"]')) {
    return { status: "failed", result: "not logged in to LinkedIn in this browser" };
  }

  const scope = () => {
    const h1 = document.querySelector("main h1, h1");
    const card = h1 && (h1.closest("section") || h1.closest("div.ph5") || h1.parentElement);
    return card || document.querySelector("main") || document.body;
  };
  const label = (el) => ((el && (el.getAttribute("aria-label") || el.textContent)) || "").trim();

  // Positive evidence only — the same rule fillLinkedInAction uses for
  // isFirstDegree, repeated here rather than shared because this file has no
  // internal imports to share it through.
  const connectionDegree = () => {
    const card = scope();
    const degreeText = (el) => `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.replace(/\s+/g, " ").trim();
    const degreeFromText = (text) => {
      if (/\b1st\b|1st[- ]degree|first[- ]degree/i.test(text)) return "1st";
      if (/\b2nd\b|2nd[- ]degree|second[- ]degree/i.test(text)) return "2nd";
      if (/\b3rd\b|3rd[- ]degree|third[- ]degree/i.test(text)) return "3rd";
      return null;
    };
    const badges = Array.from(document.querySelectorAll(
      ".dist-value, .distance-badge, .pv-member-badge, [aria-label*='degree' i], [data-test-id*='degree' i]",
    )).filter((el) => !el.closest("aside") && (card.contains(el) || document.querySelector("main")?.contains(el)));
    for (const badge of badges) {
      const degree = degreeFromText(degreeText(badge));
      if (degree) return { degree, evidence: `profile badge: ${degreeText(badge).slice(0, 80)}` };
    }
    const remove = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"], [role="menuitem"]')).find(
      (el) => !el.closest("aside") && !el.closest("[data-followthroo-overlay]") && /remove connection/i.test(label(el)),
    );
    if (remove) return { degree: "1st", evidence: "profile action: Remove Connection" };
    return { degree: "unknown", evidence: "no current profile degree badge or Remove Connection action found" };
  };
  const firstDegree = () => connectionDegree().degree === "1st";
  const detected = options.confirmedFirstDegree
    ? { degree: "1st", evidence: "confirmed by the deterministic profile check" }
    : connectionDegree();

  if (options.eligibilityOnly) {
    return detected.degree === "1st"
      ? { status: "eligible", ...detected }
      : { status: "skipped", ...detected, reasonCode: detected.degree === "unknown" ? "degree_unverified" : "degree_not_first" };
  }
  if (detected.degree !== "1st") {
    return {
      status: "skipped",
      ...detected,
      reasonCode: detected.degree === "unknown" ? "degree_unverified" : "degree_not_first",
      result: detected.degree === "unknown"
        ? "could not verify a 1st-degree connection safely; Contact info was not opened"
        : `detected ${detected.degree}-degree connection; Contact info is only shown for 1st-degree connections`,
    };
  }

  if (!options.confirmedFirstDegree && !firstDegree()) {
    return { status: "skipped", degree: "not_1st", result: "not a 1st-degree connection — Contact info is not shown" };
  }

  const modal = () => document.querySelector('.pv-contact-info, [aria-label="Contact info"], .artdeco-modal[role="dialog"]');
  let dlg = options.alreadyOpen ? modal() : null;

  // LinkedIn's usual trigger is a link reading "Contact info" inside the
  // profile's top card, pointing at /overlay/contact-info/.
  // Direct navigation and the guarded assistant fallback live in
  // enrich-flow.js, because a page navigation cannot be completed from inside
  // this serialized page function.
  if (!dlg) {
    const trigger = Array.from(scope().querySelectorAll('a[href*="overlay/contact-info"], a')).find(
      (a) => /contact info/i.test(label(a)) || /overlay\/contact-info/.test(a.getAttribute("href") || ""),
    );
    if (!trigger) return { status: "failed", result: "no Contact info link found on this profile" };
    trigger.click();
    await sleep(900);
  }

  for (let i = 0; i < 10 && !dlg; i++) {
    dlg = modal();
    if (!dlg) await sleep(300);
  }
  if (!dlg) return { status: "failed", result: "Contact info overlay did not open" };

  const closeOverlay = () => {
    const closeBtn = dlg.querySelector('button[aria-label="Dismiss"], .artdeco-modal__dismiss');
    if (closeBtn) closeBtn.click();
    else document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  };

  try {
    const emailEl = dlg.querySelector('.ci-email a[href^="mailto:"], a[href^="mailto:"]');
    const email = emailEl ? emailEl.getAttribute("href").replace(/^mailto:/i, "").split("?")[0] : null;

    const phoneEl = dlg.querySelector(".ci-phone .t-14, .ci-phone span");
    const phone = phoneEl ? (phoneEl.textContent || "").trim() : null;

    const websites = Array.from(dlg.querySelectorAll('.ci-websites a[href^="http"], a[href^="http"]'))
      .map((a) => a.getAttribute("href"))
      .filter(Boolean)
      .slice(0, 5);

    const connectedEl = dlg.querySelector(".ci-connected .t-14, .ci-connected span");
    const connectedSince = connectedEl ? (connectedEl.textContent || "").trim() : null;

    const im = Array.from(dlg.querySelectorAll(".ci-im .t-14, .ci-im span")).map((el) => (el.textContent || "").trim());

    return {
      status: "done",
      degree: "1st",
      evidence: detected.evidence,
      email,
      phone,
      extra: { websites, connectedSince, im },
      result: email || phone ? "found" : "no email or phone shown",
    };
  } finally {
    closeOverlay();
  }
}

module.exports = { fillLinkedInAction, readRecentConnections, readContactInfo };
