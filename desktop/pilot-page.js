/**
 * The page half of the pilot: describe the page, and carry out one decision.
 *
 * Both functions run inside the LinkedIn tab via `page.evaluate`, so they must
 * stay self-contained — no imports, no closure over module scope.
 *
 * The split matters. `observe()` only reads. `act()` only does what it is told,
 * and refuses anything that fails the checks below. Nothing here decides what
 * *should* happen; that is the model's job, on the server. Keeping the deciding
 * and the vetoing in different places is what stops a confidently wrong answer
 * from becoming an invitation to a stranger.
 */

/**
 * Labels that must never be clicked, whatever the model says.
 *
 * Every one of these is irreversible or actively harmful on someone's real
 * account: reporting a person, blocking them, tearing down an existing
 * connection. A model that is merely wrong should waste an action, not do one
 * of these.
 */
const FORBIDDEN = /remove connection|unfollow|report|block|withdraw|delete|restrict|unsubscribe|sign out|log out/i;

function observe() {
  const CLICKABLE =
    'button, a[role="button"], div[role="button"], [role="menuitem"], .artdeco-dropdown__item, textarea, input[type="text"]';

  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const h1 = document.querySelector("main h1, h1");

  /**
   * Who this page belongs to. Never empty when the URL says /in/<slug>.
   *
   * It came back empty on a real profile, and every name-based check hangs off
   * it — so the guard that exists to stop us acting on the wrong person was
   * silently inert, and "Follow Priyashi Negi" was clicked as though it were
   * Connect. The slug is always present and is enough to compare against.
   */
  const slugName = norm(
    decodeURIComponent((location.pathname.split("/in/")[1] || "").split(/[?#/]/)[0] || "").replace(/-/g, " "),
  )
    .replace(/\b[0-9a-f]{6,}\b/g, "")
    .trim();
  const personName = norm((h1?.textContent || "").split("\n")[0]) || slugName;

  const label = (el) => {
    // Visible words come BEFORE id and name. They were after, so any control
    // carrying an id was described to the model by that id — "ownConnect"
    // instead of "Connect" — which is both meaningless to it and impossible to
    // match when it names what it saw in the screenshot. id and name stay as a
    // last resort for fields that have no words at all.
    const text = (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.textContent ||
      el.getAttribute("name") ||
      el.getAttribute("id") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (text) return text;
    // A text box with no accessible name at all still has to be describable, or
    // the model cannot be told to type into it. LinkedIn's invite note is
    // exactly this: <textarea id="custom-message"> with no label, no
    // placeholder, nothing — so dropping unlabelled fields meant every note
    // silently went unwritten.
    const t = el.tagName.toLowerCase();
    return t === "textarea" || t === "input" ? `(${t} with no label)` : "";
  };

  const visible = (el) => {
    if (el.closest("[data-followthroo-overlay]")) return false; // our own banner
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };

  /**
   * LinkedIn's own furniture, which is not what we are here for.
   *
   * The global navbar comes first in the document, so an unfiltered list opened
   * with "Skip to search", "Skip to main content", "Home, 1 new notification",
   * "Me", "For Business" and two nav "More" buttons — and the profile's own
   * action row was buried below all of it. The model reported no Connect button
   * on a page that plainly had one.
   */
  const chrome = (el) => {
    if (el.closest('header, nav, footer, [role="banner"], [role="navigation"], .global-nav, #global-nav')) {
      return true;
    }
    const t = (el.getAttribute("aria-label") || el.textContent || "").trim();
    // The activity feed further down a profile contributes a control menu, a
    // reaction button and a repost button per post, which crowded the list with
    // a dozen "Open control menu for post by …" entries and pushed the action
    // row out of sight. None of it can send an invitation.
    return (
      /^skip to |^close jump menu/i.test(t) ||
      /^open control menu for post|^reaction button|^open reactions menu|^repost|^…\s*more$|^see more$/i.test(t)
    );
  };

  /**
   * Controls LinkedIn does not mark as controls.
   *
   * The Connect button on many profiles is this, and nothing else:
   *
   *   <span class="_9e7d82ae …">
   *     <svg id="connect-small" aria-hidden="true">…</svg>
   *     <div><span><span>Connect</span></span></div>
   *   </span>
   *
   * A bare <span>. No role, no aria-label, an aria-hidden icon, and hashed class
   * names that cannot be selected. A structural query finds nothing, so the
   * button was absent from every element list we ever produced — and each time
   * the model answered "there is no Connect button" it was describing the data
   * it had been given, accurately.
   *
   * So controls are also found the way a person finds them: something that says
   * a short thing and behaves like a button. `cursor: pointer` is the honest
   * signal — LinkedIn sets it on these spans and not on ordinary text — and an
   * icon with a short label is the shape of every action control on the page.
   */
  const looksClickable = (el) => {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    // A whole section also has "pointer" somewhere inside it; a control says one
    // short thing.
    if (!text || text.length > 40) return false;
    if (getComputedStyle(el).cursor === "pointer") return true;
    return !!el.querySelector("svg[id]");
  };

  const structural = Array.from(document.querySelectorAll(CLICKABLE));
  const textual = Array.from(document.querySelectorAll("span, div, li, a")).filter(looksClickable);

  /**
   * Keep the outermost element for a given label, drop its inner copies.
   *
   * That markup yields four nested elements whose text is exactly "Connect".
   * Clicking the innermost <span> may do nothing — the handler is on the wrapper
   * — so the outermost element carrying that exact text is the one to offer.
   */
  const candidates = [...structural, ...textual].filter(visible).filter((el) => !chrome(el));
  const nodes = candidates.filter((el) => {
    const mine = (el.textContent || "").replace(/\s+/g, " ").trim();
    return !candidates.some(
      (other) =>
        other !== el &&
        other.contains(el) &&
        (other.textContent || "").replace(/\s+/g, " ").trim() === mine,
    );
  });

  // Where the profile's own action row lives. A LinkedIn page has several
  // buttons labelled exactly "More" — the profile overflow menu, and a
  // "…see more" in About or Experience — and a label alone cannot tell them
  // apart. The model was picking one at random, opening something with no
  // Connect in it, and giving up. Anything sharing an ancestor with the <h1> is
  // in the top card; that is the one that matters.
  /**
   * The container that holds BOTH the name and the profile's action buttons.
   *
   * Walking up from the <h1> to the nearest <section> assumed LinkedIn keeps the
   * heading and the buttons in one element. It frequently does not, so the
   * marker came back false for the very button it exists to identify — and the
   * model, told to prefer marked elements, reported that no Connect had the
   * attribute and gave up on a profile whose Connect it could see in the
   * screenshot.
   *
   * So climb until the ancestor also contains a Message or More action. That is
   * the action row by definition, whatever it is wrapped in today.
   */
  const topCard = (() => {
    if (!h1) return null;
    const hasAction = (node) =>
      Array.from(node.querySelectorAll('button, div[role="button"], a[role="button"]')).some((b) =>
        /^(message|more|connect|invite|follow)\b/i.test(
          (b.getAttribute("aria-label") || b.textContent || "").trim(),
        ),
      );
    let node = h1.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      if (hasAction(node)) return node;
      node = node.parentElement;
    }
    return h1.closest("section") || h1.parentElement;
  })();

  /** The nearest heading above an element, as a human would describe where it is. */
  const sectionOf = (el) => {
    const sec = el.closest("section, [data-view-name]");
    const head = sec && sec.querySelector("h1, h2, h3");
    return head ? (head.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) : null;
  };

  const elements = [];
  nodes.forEach((el, idx) => {
    const l = label(el);
    if (!l) return;
    // Stamped so `act` resolves the very element that was described, rather than
    // re-running a query that may have shifted underneath us.
    el.setAttribute("data-ft-idx", String(idx));
    // Stamped on the element itself so text resolution can prefer the profile's
    // own action row without recomputing which container that is.
    if (topCard && topCard.contains(el)) el.setAttribute("data-ft-top", "1");
    else el.removeAttribute("data-ft-top");
    const r = el.getBoundingClientRect();
    elements.push({
      i: idx,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      label: l,
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      inDialog: !!el.closest('[role="dialog"], .artdeco-modal'),
      inAside: !!el.closest("aside"),
      // The three that disambiguate two identical "More" buttons.
      inTopCard: !!(topCard && topCard.contains(el)),
      section: sectionOf(el),
      y: Math.round(r.top + window.scrollY),
    });
  });

  // The profile's own controls first, then everything else in document order.
  // The list is what the model reads top-down, and burying Connect under thirty
  // unrelated buttons is how it concludes there is not one.
  elements.sort((a, b) => {
    const rank = (e) => (e.inDialog ? 0 : e.inTopCard ? 1 : e.inAside ? 3 : 2);
    return rank(a) - rank(b) || a.y - b.y;
  });

  return {
    personName,
    url: location.href,
    /** Has the profile actually rendered, or are we looking at a shell? */
    profileReady: !!(h1 && personName && elements.some((e) => e.inTopCard)),
    signedOut:
      /\/(login|checkpoint|authwall)/.test(location.pathname) ||
      !!document.querySelector('input[name="session_key"]'),
    dialogOpen: !!document.querySelector('.artdeco-modal[role="dialog"], div[role="dialog"]'),
    // Read from the page rather than inferred, so "already connected" is a fact
    // and not a guess made from the absence of a button.
    firstDegree:
      /1st/i.test(document.querySelector(".dist-value, .distance-badge")?.textContent || "") ||
      Array.from(document.querySelectorAll('button, div[role="button"], [role="menuitem"]')).some((b) =>
        /remove connection/i.test((b.getAttribute("aria-label") || b.textContent || "")),
      ),
    limitWall: (() => {
      const dlg = document.querySelector('.artdeco-modal[role="dialog"], div[role="dialog"]');
      const t = ((dlg && dlg.textContent) || "").toLowerCase();
      if (/weekly invitation limit|reached the weekly|try again next week/.test(t)) {
        return "LinkedIn says this account has hit its weekly invitation limit";
      }
      if (/restricted|unusual activity|verify your identity/.test(t)) {
        return "LinkedIn is showing a restriction or verification prompt";
      }
      return null;
    })(),
    elements,
  };
}

/**
 * Carry out one decision, or refuse it.
 *
 * `expectedName` is the profile owner. The model is told never to touch another
 * person's Connect button; this is where that stops being a request. A LinkedIn
 * profile carries other people's buttons in "People also viewed" and "More
 * profiles for you", and their labels carry their own names, so a label naming
 * somebody else is disqualifying on its face.
 */
function act({ decision, expectedName, forbiddenSource, goal }) {
  const FORBIDDEN_RE = new RegExp(forbiddenSource, "i");

  /**
   * Find a control by the words on it.
   *
   * This is what rescues a control the element list cannot describe — an
   * unlabelled <span> with "Connect" inside it. It is also weaker evidence than
   * an index: "Connect" is equally the text on the sidebar strangers' buttons,
   * and that span carries no name, so the check that catches "Invite Wrong
   * Person to connect" has nothing to read.
   *
   * So it is ordered, and it refuses rather than guesses. An ambiguous click is
   * how the wrong person receives an invitation, and that cannot be taken back.
   */
  const resolveByText = (wanted) => {
    const want = String(wanted || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!want) return { error: "no text to look for" };

    const seen = Array.from(document.querySelectorAll("[data-ft-idx]")).filter(
      (el) => (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === want,
    );
    if (!seen.length) return { error: `nothing on the page reads exactly "${wanted}"` };

    const inDialog = seen.filter((el) => el.closest('[role="dialog"], .artdeco-modal'));
    if (inDialog.length) return { el: inDialog[0] };

    /**
     * Other people's controls, which are not all in <aside>.
     *
     * "More profiles for you" sits inside <main> and renders a Connect per
     * stranger, so excluding the sidebar alone still leaves somebody else's
     * button as a candidate — and with only one of them left it would have been
     * accepted as unambiguous. The heading above it is what gives it away.
     */
    const recommendation = (el) => {
      const sec = el.closest("section, [data-view-name]");
      const head = sec && sec.querySelector("h1, h2, h3");
      return /people also viewed|more profiles|people you may know|others? named|similar profiles/i.test(
        (head?.textContent || "").trim(),
      );
    };

    const outside = seen.filter((el) => !el.closest("aside") && !recommendation(el));
    if (!outside.length) {
      return { error: `every "${wanted}" on this page belongs to somebody else's card` };
    }

    const topCardEls = outside.filter((el) => el.getAttribute("data-ft-top") === "1");
    if (topCardEls.length) return { el: topCardEls[0] };
    if (outside.length === 1) return { el: outside[0] };

    return {
      error: `"${wanted}" matches ${outside.length} places and none is the profile's own action row — refusing to guess whose it is`,
    };
  };

  let el;
  if (decision.label && (decision.index === undefined || decision.index === null)) {
    const found = resolveByText(decision.label);
    if (found.error) return { ok: false, error: `refused: ${found.error}` };
    el = found.el;
  } else {
    el = document.querySelector(`[data-ft-idx="${decision.index}"]`);
    // An index that has gone stale but a text description that has not is worth
    // one more try — the page reflows constantly.
    if (!el && decision.label) {
      const found = resolveByText(decision.label);
      if (found.error) return { ok: false, error: `refused: ${found.error}` };
      el = found.el;
    }
  }
  if (!el) return { ok: false, error: `element ${decision.index} is no longer on the page` };

  const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "")
    .replace(/\s+/g, " ")
    .trim();

  if (el.closest("aside")) return { ok: false, error: `refused: "${label}" is in the sidebar` };
  if (el.closest("[data-followthroo-overlay]")) return { ok: false, error: "refused: that is our own banner" };
  if (FORBIDDEN_RE.test(label)) return { ok: false, error: `refused: "${label}" is destructive` };

  // Somebody else's button. The check is deliberately narrow — it only fires
  // when the label names a person AND that person is not the one we are on.
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  // Following is not connecting. "Follow <name>" sits exactly where Connect sits
  // on a profile that has no Connect on its card, and it was clicked as though
  // it were one — which follows somebody on their real account instead of asking
  // to connect, and leaves the button reading "Following, click to unfollow".
  if (goal === "invite" && /^follow\b/i.test(label)) {
    return { ok: false, error: `refused: "${label}" follows them, it does not connect` };
  }

  const named = /^(invite|message|follow|connect with)\s+(.+?)(\s+to (connect|follow))?$/i.exec(label);
  if (named) {
    // Fails closed. expectedName came back empty on a real profile and this
    // check simply did not run, so a button naming somebody was allowed through
    // unexamined. If we cannot say whose page this is, we cannot say the button
    // is theirs either.
    if (!expectedName) {
      return { ok: false, error: `refused: "${label}" names a person and this profile could not be identified` };
    }
    const who = norm(named[2]);
    if (who && who.length > 2 && !norm(label).includes(expectedName) && !expectedName.includes(who)) {
      return { ok: false, error: `refused: "${label}" is not ${expectedName}` };
    }
  }

  if (decision.action === "type") {
    const tag = el.tagName.toLowerCase();
    const typeable = tag === "textarea" || tag === "input" || el.isContentEditable;
    // Typing into a button does not fail loudly — execCommand quietly does
    // nothing and the fallback would overwrite the button's own text — so the
    // note ends up nowhere and the run carries on believing it was written.
    if (!typeable) return { ok: false, error: `refused: "${label}" is not a text box` };
    const text = String(decision.text ?? "");
    el.focus();
    if ("value" in el && el.tagName !== "DIV") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // execCommand is the only focus-dependent call in here, and it returns
      // false rather than throwing when the window is in the background — which
      // is the normal state while someone carries on working.
      const typed = document.execCommand("insertText", false, text);
      if (!typed || !(el.textContent || "").trim()) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      }
    }
    return { ok: true, did: `typed into "${label}"` };
  }

  el.click();
  return { ok: true, did: `clicked "${label}"` };
}

module.exports = { observe, act, FORBIDDEN };
