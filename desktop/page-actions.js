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
    if (!h1) return document.querySelector("main") || document.body;

    // Current LinkedIn profiles use a div data-view-name top card. The old
    // selector stopped at the heading's wrapper while the visible "1st" badge
    // sits beside pronouns higher in that same card.
    const main = document.querySelector("main") || document.body;
    let node = h1.parentElement;
    while (node && node !== main && node !== document.body) {
      const view = node.getAttribute("data-view-name") || "";
      const classes = typeof node.className === "string" ? node.className : "";
      if (/profile.*top.*card|top.*card.*profile/i.test(`${view} ${classes}`)) return node;
      node = node.parentElement;
    }
    return h1.closest("section") || h1.closest("div.ph5") || h1.parentElement || main;
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
    // The current profile header may be a plain "1st" span beside pronouns.
    // This stays inside the owner's top card; a recommendation cannot turn an
    // invitation into a message or a lookup into an eligible profile.
    const headerDegree = Array.from(scope().querySelectorAll("[aria-label*='degree' i], [data-test-id*='degree' i], span, p, div"))
      .some((el) => {
        const text = `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.replace(/\s+/g, " ").trim();
        return text.length <= 160 && /\b1st\b|1st[- ]degree|first[- ]degree/i.test(text);
      });
    if (headerDegree) return true;
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
 * Detection is deliberately signal-based rather than selector-based. Five
 * builds in a row (desktop 1.15.0-1.15.4) each swapped one guessed selector
 * for another and each still reported LinkedIn's visibly-open overlay as
 * absent, because a single missed class or a renamed label was enough to
 * fail the whole check. So: four independent routes to the panel, shadow
 * roots included, and `waiting` rather than `failed` whenever the answer is
 * only "not yet". Whatever LinkedIn changes next should cost one route, not
 * the lookup.
 *
 * `status: "waiting"` means look again — polling belongs to the caller, which
 * re-evaluates this function and so survives a re-render between looks. A
 * failure carries `diagnostics`, including up to 20KB of the panel's real
 * markup, so the next selector fix is written from the page rather than from
 * a guess about it.
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
    if (!h1) return document.querySelector("main") || document.body;

    // Current LinkedIn profiles use a div data-view-name top card. The old
    // selector stopped at the heading's wrapper while the visible "1st" badge
    // sits beside pronouns higher in that same card.
    const main = document.querySelector("main") || document.body;
    let node = h1.parentElement;
    while (node && node !== main && node !== document.body) {
      const view = node.getAttribute("data-view-name") || "";
      const classes = typeof node.className === "string" ? node.className : "";
      if (/profile.*top.*card|top.*card.*profile/i.test(`${view} ${classes}`)) return node;
      node = node.parentElement;
    }
    return h1.closest("section") || h1.closest("div.ph5") || h1.parentElement || main;
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
    // LinkedIn's current header can render a plain <span> beside pronouns
    // ("She/Her  1st") without a class or aria label. Only inspect the profile
    // top card so a recommended profile can never authorise this lookup.
    const badges = Array.from(card.querySelectorAll(
      ".dist-value, .distance-badge, .pv-member-badge, [aria-label*='degree' i], [data-test-id*='degree' i], span, p, div",
    )).filter((el) => {
      if (el.closest("aside")) return false;
      const text = degreeText(el);
      return !!degreeFromText(text) && (text.length <= 160 || /degree/i.test(text));
    });
    // Prefer the smallest matching node. A top-card wrapper can include a
    // suggested person's 2nd badge in its text; the actual header's own span
    // is the short, precise evidence we want to record.
    badges.sort((a, b) => degreeText(a).length - degreeText(b).length);
    for (const badge of badges) {
      const degree = degreeFromText(degreeText(badge));
      if (degree) return { degree, evidence: `profile header badge: ${degreeText(badge).slice(0, 80)}` };
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

  // --- Shadow-piercing queries -------------------------------------------
  //
  // Copied from pilot-page.js's observe(), which is the reader the invitation
  // lane uses and the reason it can see LinkedIn's modals when this one could
  // not. It cannot be imported: Playwright serializes this function by source,
  // so it has no access to anything outside its own body — the same reason
  // observe() and act() carry their own copies of these three.
  const querySelectorAllDeep = (selector, root = document) => {
    const results = [];
    const queue = [root];
    const seenRoots = new Set();
    while (queue.length > 0) {
      const curr = queue.shift();
      if (!curr || seenRoots.has(curr)) continue;
      seenRoots.add(curr);
      try {
        if (curr.querySelectorAll) {
          const matched = curr.querySelectorAll(selector);
          for (let i = 0; i < matched.length; i++) results.push(matched[i]);
          const all = curr.querySelectorAll("*");
          for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (el && el.shadowRoot && !seenRoots.has(el.shadowRoot)) queue.push(el.shadowRoot);
          }
        }
      } catch (_) {}
    }
    return results;
  };
  const querySelectorDeep = (selector, root = document) => {
    const found = querySelectorAllDeep(selector, root);
    return found.length ? found[0] : null;
  };
  const closestDeep = (el, selector) => {
    let curr = el;
    while (curr && curr !== document && curr !== document.body) {
      if (curr.matches && curr.matches(selector)) return curr;
      const root = curr.getRootNode ? curr.getRootNode() : null;
      if (root && typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot && (curr === root || !curr.parentElement)) {
        curr = root.host;
      } else if (curr.parentElement) {
        curr = curr.parentElement;
      } else if (curr.parentNode) {
        curr = curr.parentNode;
        if (typeof ShadowRoot !== "undefined" && curr instanceof ShadowRoot) curr = curr.host;
      } else {
        break;
      }
    }
    return null;
  };

  const DIALOG = '[role="dialog"], [aria-modal="true"], .artdeco-modal, .artdeco-modal-overlay, #artdeco-modal-outlet > *, [data-view-name*="contact-info" i], .pv-contact-info';
  // Prefixes, not whole-string equality. "Websites", "Connected since" and
  // "Phone (Mobile)" all have to count, and the exact-equality version of this
  // test is what reported the open overlay as absent.
  const ROW_LABEL = /^(e-?mail|phone|im\b|instant message|website|address|birthday|connected|twitter|profile)/i;
  const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

  const textOf = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const rowLabelsIn = (container) =>
    querySelectorAllDeep('h1, h2, h3, h4, [role="heading"], dt, dd, strong, span, p, li', container)
      .map(textOf)
      .filter((t) => t && t.length <= 40 && ROW_LABEL.test(t));

  /**
   * Where the Contact info panel is, resolved from whichever signal survived.
   *
   * Four independent routes, because any one of them is what LinkedIn changes
   * next: a dialog container, the heading, a mailto:/tel: link, and the URL.
   *
   * The version this replaces had one route, gated on a descendant whose
   * entire text was exactly "Contact info" AND another whose entire text was
   * exactly one of "email|phone|im|connected since|website". Held against
   * fixtures, that gate passes on a plain dialog and fails on: a label worded
   * "Email address", a dialog inside a shadow root (it used
   * document.querySelectorAll, which does not cross one), and a shell whose
   * rows have not rendered yet. Any single one of those is enough to lose
   * every lookup, which is what happened.
   */
  const findPanel = () => {
    const dialogs = querySelectorAllDeep(DIALOG).filter(visible);
    for (const d of dialogs) {
      if (/contact\s*info/i.test(textOf(d))) return { panel: d, strategy: "dialog-container", dialogs };
    }
    const heading = querySelectorAllDeep('h1, h2, h3, h4, [role="heading"], dt, strong, span, p')
      .find((el) => /^contact\s*info$/i.test(textOf(el)) && visible(el));
    if (heading) {
      const dlg = closestDeep(heading, DIALOG);
      if (dlg && visible(dlg)) return { panel: dlg, strategy: "heading-in-dialog", dialogs };
      let node = heading.parentElement;
      for (let i = 0; i < 6 && node && node !== document.body; i++) {
        if (rowLabelsIn(node).length) return { panel: node, strategy: "heading-ancestor", dialogs };
        node = node.parentElement;
      }
    }
    const contactLink = querySelectorAllDeep('a[href^="mailto:"], a[href^="tel:"]').find(visible);
    if (contactLink) {
      const dlg = closestDeep(contactLink, DIALOG);
      if (dlg && visible(dlg)) return { panel: dlg, strategy: "contact-link-in-dialog", dialogs };
    }
    return { panel: null, strategy: null, dialogs };
  };

  const onOverlayUrl = () => /\/overlay\/contact-info/.test(location.pathname);
  const challenged = () =>
    /\/(checkpoint|authwall)/.test(location.pathname) ||
    !!querySelectorDeep('iframe[src*="captcha" i], [data-test-id*="captcha" i], [id*="captcha" i]');

  /**
   * Which state the overlay is in — never a bare boolean, because "not open"
   * and "open but its rows have not rendered yet" need opposite handling and
   * the old code could not tell them apart.
   */
  const detect = () => {
    if (challenged()) return { state: "SECURITY_CHALLENGE", panel: null, strategy: null, dialogs: [], labels: [] };
    const { panel, strategy, dialogs } = findPanel();
    if (!panel) {
      return { state: onOverlayUrl() || dialogs.length ? "OPEN_LOADING" : "CLOSED", panel: null, strategy: null, dialogs, labels: [] };
    }
    const labels = rowLabelsIn(panel);
    const hasValue = !!querySelectorDeep('a[href^="mailto:"], a[href^="tel:"]', panel) || labels.length > 0;
    return { state: hasValue ? "OPEN_READABLE" : "OPEN_LOADING", panel, strategy, dialogs, labels };
  };

  /**
   * What the run needs to see when this fails: enough of the real page to fix
   * the selector without guessing, and nothing that identifies the session.
   * No cookies, no tokens, no storage — markup and visible text only.
   */
  const diagnose = (found) => {
    let dump = found.panel || null;
    if (!dump) {
      const dialog = found.dialogs.find((d) => textOf(d).length > 20);
      if (dialog) dump = dialog;
    }
    if (!dump) {
      // Last resort: whatever element says "Contact info" and is small enough
      // to be the panel rather than the whole page.
      const mentions = querySelectorAllDeep("h1, h2, h3, h4, [role='heading'], section, div, span, p")
        .filter((el) => {
          const t = textOf(el);
          return t.length > 20 && t.length < 3000 && /contact\s*info/i.test(t);
        })
        .sort((a, b) => textOf(a).length - textOf(b).length);
      dump = mentions[0] || null;
    }
    return {
      currentUrl: location.href,
      onOverlayUrl: onOverlayUrl(),
      overlayState: found.state,
      chosenStrategy: found.strategy,
      dialogCount: querySelectorAllDeep(DIALOG).length,
      visibleDialogCount: found.dialogs.length,
      headingFound: !!querySelectorAllDeep("h1, h2, h3, h4, [role='heading'], span, p").find((el) => /^contact\s*info$/i.test(textOf(el))),
      shadowRootsSeen: querySelectorAllDeep("*").filter((el) => el.shadowRoot).length,
      rowLabelsSeen: found.labels.slice(0, 20),
      mailtoCount: querySelectorAllDeep('a[href^="mailto:"]').length,
      visibleTextSample: dump ? textOf(dump).slice(0, 600) : textOf(document.querySelector("main") || document.body).slice(0, 600),
      html: dump && dump.outerHTML ? dump.outerHTML.slice(0, 20000) : null,
    };
  };

  // Asked for once, by a caller that has given up — never on the way there.
  // diagnose() walks every element on the page looking for shadow roots, which
  // is far too expensive to repeat on each of the eight looks a lookup takes.
  if (options.diagnoseOnly) {
    return { status: "diagnostics", diagnostics: diagnose(detect()) };
  }

  // LinkedIn's usual trigger is a link reading "Contact info" inside the
  // profile's top card, pointing at /overlay/contact-info/. Navigation to that
  // URL, and the polling between looks, live in enrich-flow.js — a page
  // navigation cannot be completed from inside this serialized function, and
  // re-evaluating it is what survives a re-render between looks.
  let found = detect();
  if (found.state === "CLOSED" && options.clickTrigger) {
    const trigger = Array.from(scope().querySelectorAll('a[href*="overlay/contact-info"], a')).find(
      (a) => /contact info/i.test(label(a)) || /overlay\/contact-info/.test(a.getAttribute("href") || ""),
    );
    if (!trigger) {
      return { status: "failed", reasonCode: "no_contact_link", result: "no Contact info link found on this profile", diagnostics: diagnose(found) };
    }
    trigger.click();
    await sleep(900);
    found = detect();
  }

  if (found.state === "SECURITY_CHALLENGE") {
    return { status: "failed", reasonCode: "security_challenge", fatal: true, result: "LinkedIn is showing a checkpoint or verification prompt — stopping rather than retrying", diagnostics: diagnose(found) };
  }
  // Not readable yet is not the same as not open. The caller polls; only it
  // knows whether the budget is spent. Deliberately cheap — this is the
  // return that happens eight times, so it carries counts rather than a full
  // page walk; the caller asks for diagnoseOnly once it gives up.
  if (found.state !== "OPEN_READABLE") {
    return {
      status: "waiting",
      state: found.state,
      visibleDialogCount: found.dialogs.length,
      result: found.state === "OPEN_LOADING" ? "Contact info is opening" : "Contact info overlay is not open yet",
    };
  }

  const panel = found.panel;
  const closeOverlay = () => {
    const closeBtn = querySelectorDeep('button[aria-label="Dismiss"], button[aria-label*="close" i], .artdeco-modal__dismiss', panel);
    if (closeBtn) closeBtn.click();
    else document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  };

  try {
    /**
     * The value beside a label. LinkedIn nests each row's label and value in
     * their own spans, so the row's combined text reads "Emailsomeone@x.com" —
     * which is why the value has to be found by locating the label node first
     * and subtracting its own text, never by matching the row's text.
     */
    const valueFor = (re) => {
      const nodes = querySelectorAllDeep('h1, h2, h3, h4, [role="heading"], dt, dd, strong, span, p, div, li', panel);
      for (const labelNode of nodes) {
        const labelText = textOf(labelNode);
        if (!labelText || labelText.length > 40 || !re.test(labelText)) continue;
        let row = labelNode.parentElement;
        for (let i = 0; i < 4 && row && row !== panel; i++) {
          const rest = textOf(row).replace(labelText, "").trim();
          if (rest) return rest.slice(0, 200);
          row = row.parentElement;
        }
      }
      return null;
    };
    // Leaves only: an ancestor's text is every row concatenated, and a regex
    // over that happily matches "Emailsomeone@x.com" as an address.
    const leafTexts = querySelectorAllDeep("*", panel)
      .filter((el) => el.children && el.children.length === 0)
      .map(textOf)
      .filter(Boolean);

    const mailto = querySelectorDeep('a[href^="mailto:"]', panel);
    const emailFromRow = valueFor(/^e-?mail/i);
    const emailFromText = leafTexts.map((t) => (t.match(EMAIL_RE) || [])[0]).find(Boolean) || null;
    const email = mailto
      ? decodeURIComponent((mailto.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0]).trim()
      : (emailFromRow && EMAIL_RE.test(emailFromRow) ? (emailFromRow.match(EMAIL_RE) || [])[0] : null) || emailFromText;

    const tel = querySelectorDeep('a[href^="tel:"]', panel);
    const phone = tel
      ? decodeURIComponent((tel.getAttribute("href") || "").replace(/^tel:/i, "")).trim()
      : valueFor(/^phone/i);

    // The person's own profile row is a linkedin.com link and is not a website
    // they listed; the old version reported it as one.
    const websites = querySelectorAllDeep('a[href^="http"]', panel)
      .map((a) => a.getAttribute("href"))
      .filter((href) => href && !/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(href))
      .filter((href, i, all) => all.indexOf(href) === i)
      .slice(0, 5);

    const connectedSince = valueFor(/^connected/i);
    const imValue = valueFor(/^(im\b|instant message)/i);
    const address = valueFor(/^address/i);
    const birthday = valueFor(/^birthday/i);

    return {
      status: "done",
      degree: "1st",
      evidence: detected.evidence,
      email: email || null,
      phone: phone || null,
      extra: {
        websites,
        connectedSince,
        im: imValue ? [imValue] : [],
        address,
        birthday,
        strategy: found.strategy,
      },
      result: email || phone ? "found" : "no email or phone shown",
    };
  } finally {
    closeOverlay();
  }
}

module.exports = { fillLinkedInAction, readRecentConnections, readContactInfo };
