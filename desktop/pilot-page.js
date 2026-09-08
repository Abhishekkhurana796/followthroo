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
  const personName = norm((h1?.textContent || "").split("\n")[0]);

  const label = (el) => {
    const text = (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("id") ||
      el.textContent ||
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

  const nodes = Array.from(document.querySelectorAll(CLICKABLE)).filter(visible);

  // Where the profile's own action row lives. A LinkedIn page has several
  // buttons labelled exactly "More" — the profile overflow menu, and a
  // "…see more" in About or Experience — and a label alone cannot tell them
  // apart. The model was picking one at random, opening something with no
  // Connect in it, and giving up. Anything sharing an ancestor with the <h1> is
  // in the top card; that is the one that matters.
  const topCard = h1 && (h1.closest("section") || h1.closest("div.ph5") || h1.parentElement);

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

  return {
    personName,
    url: location.href,
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
function act({ decision, expectedName, forbiddenSource }) {
  const FORBIDDEN_RE = new RegExp(forbiddenSource, "i");
  const el = document.querySelector(`[data-ft-idx="${decision.index}"]`);
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
  const named = /^(invite|message|follow|connect with)\s+(.+?)\s+(to connect|to follow)?$/i.exec(label);
  if (named && expectedName) {
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
