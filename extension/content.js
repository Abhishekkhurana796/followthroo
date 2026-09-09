/**
 * The in-page bar on LinkedIn.
 *
 * Two ways into the same feature, for two different moments:
 *
 *   - You are in the app, you paste a URL, the extension opens a tab and reads
 *     it in bulk. Good for "give me the 500 people in this search".
 *   - You are already browsing LinkedIn, looking at real people, and you want
 *     *these four*. That is this file.
 *
 * The second is the one people reach for most, because it is what they are
 * already doing. It is also the honest one: you can see exactly who you picked,
 * so nothing arrives in the CRM that you did not look at.
 *
 * Design rules this follows:
 *   - Never obscure LinkedIn's own controls. The bar sits above the list, in
 *     flow, not floating over the page.
 *   - Look like us, not like LinkedIn. Somebody should never be confused about
 *     which product just added a checkbox to their screen.
 *   - Do nothing until asked. No selection is made for you, and the bar has one
 *     primary action.
 */
(() => {
  if (window.__ftBarLoaded) return; // survives LinkedIn's SPA re-renders
  window.__ftBarLoaded = true;

  const ACCENT = "#4B31E6";
  const BAR_ID = "ft-bar";
  const CHECK_CLASS = "ft-row-check";

  const state = { selected: new Map(), kind: null, busy: false };

  /** The build actually executing in this tab. */
  const version = () => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "?";
    }
  };

  /* ---------------------------------------------------------------- */

  /**
   * Take our colours from the page we landed on.
   *
   * LinkedIn's dark mode is an account setting, not a browser one, so
   * `prefers-color-scheme` is the wrong question — a member can be in LinkedIn
   * dark on a light OS. The reliable signal is what the page is actually
   * painting, so read the body's background luminance and derive from that. It
   * also means a third LinkedIn theme, or a change to the existing ones, needs
   * no work here.
   */
  function applyTheme() {
    const root = document.documentElement;

    /**
     * Luminance of an actually-painted background, or null.
     *
     * The alpha check is the whole point: an element with no background of its
     * own computes to `rgba(0, 0, 0, 0)`, and read naively that is pure black.
     * A transparent <body> is completely ordinary, so without this the bar goes
     * dark on a perfectly white page.
     */
    const painted = (el) => {
      if (!el) return null;
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor || "");
      if (!m) return null;
      if (m[4] !== undefined && Number(m[4]) < 0.5) return null; // see-through
      return 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
    };

    // body first, then <html>, then give up and assume light — a white bar that
    // corrects to dark a moment later is less jarring than the reverse.
    const lum = painted(document.body) ?? painted(root) ?? 255;
    const dark = lum < 128;
    if (root.dataset.ftDark === String(dark)) return;
    root.dataset.ftDark = String(dark);

    const set = (k, v) => root.style.setProperty(k, v);
    set("--ft-surface", dark ? "#1b1f23" : "#ffffff");
    set("--ft-raised", dark ? "#26292d" : "#ffffff");
    set("--ft-ink", dark ? "#e8e8ea" : "#0a0a0a");
    set("--ft-soft", dark ? "#9aa0a6" : "#5b5b66");
    set("--ft-line", dark ? "rgba(255,255,255,.14)" : "#e3e3e6");
    set("--ft-shadow", dark ? "rgba(0,0,0,.55)" : "rgba(10,10,10,.13)");
    set("--ft-ok", dark ? "#4ade80" : "#0f7b52");
    set("--ft-err", dark ? "#f87171" : "#b91c1c");
    set("--ft-tint", dark ? "rgba(139,123,255,.16)" : "#f3f1fe");
    // The accent is the one thing that does not move: it is the identity.
    set("--ft-accent", ACCENT);
    set("--ft-on-accent", "#ffffff");
  }

  function styles() {
    if (document.getElementById("ft-style")) return;
    const el = document.createElement("style");
    el.id = "ft-style";
    el.textContent = `
      /* Every colour comes from applyTheme(), which reads what LinkedIn is
         actually painting. The accent is the exception — that is us. */

      /* ---- The bar ----------------------------------------------------
         Two states. Dormant it is a thin, quiet strip that says what it can do.
         Active it carries weight and one primary action, so ticking somebody
         feels like it changed something. It used to look identical either way. */
      #${BAR_ID}{position:sticky;top:56px;z-index:400;display:flex;align-items:center;gap:12px;
        margin:0 0 12px;padding:9px 14px;border:1px solid var(--ft-line);border-radius:12px;
        background:var(--ft-surface);box-shadow:0 1px 2px var(--ft-shadow);
        font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:var(--ft-ink);
        transition:box-shadow .18s ease,border-color .18s ease}
      #${BAR_ID}.ft-active{border-color:color-mix(in srgb,${ACCENT} 45%,transparent);
        box-shadow:0 2px 14px color-mix(in srgb,${ACCENT} 18%,transparent)}
      #${BAR_ID} .ft-brand{display:flex;align-items:center;gap:7px;font-weight:700;flex:0 0 auto}
      #${BAR_ID} .ft-mark{width:18px;height:18px;border-radius:5px;background:${ACCENT};
        color:var(--ft-on-accent);display:grid;place-items:center;font-size:11px;font-weight:800}
      #${BAR_ID} .ft-sep{width:1px;height:20px;background:var(--ft-line);flex:0 0 auto}
      #${BAR_ID} .ft-count{color:var(--ft-soft);flex:1 1 auto;min-width:0}
      #${BAR_ID}.ft-active .ft-count{color:var(--ft-ink);font-weight:600}
      #${BAR_ID} button{border:0;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:600;
        cursor:pointer;font-family:inherit;transition:background .15s ease,color .15s ease}
      #${BAR_ID} .ft-link{background:none;color:var(--ft-soft);padding:7px 6px}
      #${BAR_ID} .ft-link:hover{color:var(--ft-ink);background:var(--ft-tint)}
      #${BAR_ID} .ft-primary{background:${ACCENT};color:var(--ft-on-accent)}
      #${BAR_ID} .ft-primary:hover:not(:disabled){filter:brightness(1.08)}
      #${BAR_ID} .ft-primary:disabled{background:var(--ft-tint);color:var(--ft-soft);cursor:default}
      #${BAR_ID} .ft-msg{font-size:12px}
      #${BAR_ID} .ft-ok{color:var(--ft-ok)}
      #${BAR_ID} .ft-err{color:var(--ft-err)}
      #${BAR_ID} :focus-visible,#ft-launcher :focus-visible,#ft-panel :focus-visible{
        outline:2px solid ${ACCENT};outline-offset:2px}

      /* The checkbox sits INSIDE the row's own padding. At -30px it lived
         outside the card, which is why it collided with LinkedIn's layout at
         some widths and vanished at others. */
      .${CHECK_CLASS}{position:absolute;left:8px;top:12px;width:17px;height:17px;cursor:pointer;
        accent-color:${ACCENT};z-index:399;margin:0}
      .ft-anchor{position:relative}
      .ft-anchor:has(.${CHECK_CLASS}:checked){background:var(--ft-tint);border-radius:8px}

      /* ---- Floating launcher ----------------------------------------
         Present on every LinkedIn page, because the bar only makes sense on a
         list and people need a way in from a profile, a company, or a page we
         could not read. Draggable, because a fixed overlay will eventually sit
         on top of something that matters. */
      #ft-launcher{position:fixed!important;right:0;top:40%;z-index:2147483646;
        display:flex;align-items:center;gap:3px;padding:7px 5px 7px 3px;
        background:var(--ft-surface);border:1px solid var(--ft-line);border-right:0;
        border-radius:12px 0 0 12px;box-shadow:0 3px 16px var(--ft-shadow);
        font-family:-apple-system,Segoe UI,Roboto,sans-serif;cursor:default;
        user-select:none;touch-action:none;
        transition:box-shadow .2s ease,transform .2s ease}
      #ft-launcher:hover{transform:translateX(-2px);box-shadow:0 6px 22px var(--ft-shadow)}
      #ft-launcher .ft-grip{width:11px;height:28px;cursor:grab;flex:0 0 auto;border-radius:3px;
        background-image:radial-gradient(var(--ft-soft) 1.1px, transparent 1.2px);
        background-size:5px 5px;background-position:center;opacity:.55}
      #ft-launcher .ft-grip:hover{opacity:1}
      #ft-launcher.ft-dragging{transition:none}
      #ft-launcher.ft-dragging .ft-grip{cursor:grabbing;opacity:1}
      #ft-launcher .ft-open{position:relative;width:34px;height:34px;border:0;border-radius:10px;
        background:${ACCENT};color:var(--ft-on-accent);font-weight:800;font-size:15px;cursor:pointer;
        display:grid;place-items:center;font-family:inherit;line-height:1}
      /* The status dot is the only thing that answers "is this on?" at a glance,
         so it sits on the corner of the mark at a size you can actually see. */
      #ft-launcher .ft-dot{position:absolute;right:-3px;bottom:-3px;width:11px;height:11px;
        border-radius:50%;border:2px solid var(--ft-surface);box-sizing:border-box}
      #ft-launcher .ft-dot.on{background:var(--ft-ok)}
      #ft-launcher .ft-dot.off{background:var(--ft-err)}

      /* ---- Panel ----
         Anchored to the launcher with a pointer, because it belongs to it. A
         floating card would read as a modal, and this is a menu. */
      #ft-panel{position:fixed!important;z-index:2147483647;width:296px;
        background:var(--ft-surface);border:1px solid var(--ft-line);border-radius:14px;
        box-shadow:0 12px 40px var(--ft-shadow);padding:15px;
        font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:var(--ft-ink)}
      #ft-panel::after{content:"";position:absolute;right:-6px;top:22px;width:10px;height:10px;
        background:var(--ft-surface);border-right:1px solid var(--ft-line);
        border-top:1px solid var(--ft-line);transform:rotate(45deg)}
      #ft-panel h4{margin:0 0 3px;font-size:14px;font-weight:700;letter-spacing:-.01em}
      #ft-panel p{margin:0;color:var(--ft-soft);font-size:12px;line-height:1.5}
      #ft-panel .ft-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
      #ft-panel .ft-mark{width:20px;height:20px;border-radius:6px;background:${ACCENT};
        color:var(--ft-on-accent);display:grid;place-items:center;font-size:11px;font-weight:800}
      #ft-panel .ft-x{margin-left:auto;border:0;background:none;cursor:pointer;
        color:var(--ft-soft);font-size:17px;line-height:1;padding:2px 5px;border-radius:6px}
      #ft-panel .ft-x:hover{background:var(--ft-tint);color:var(--ft-ink)}
      #ft-panel button.ft-act{width:100%;margin-top:12px;border:0;border-radius:9px;
        padding:10px 12px;background:${ACCENT};color:var(--ft-on-accent);font-weight:600;
        font-size:13px;cursor:pointer;font-family:inherit}
      #ft-panel button.ft-act:hover{filter:brightness(1.08)}
      #ft-panel button.ft-act:disabled{opacity:.45;cursor:default}
      #ft-panel button.ft-ghost{width:100%;margin-top:6px;border:1px solid var(--ft-line);
        border-radius:9px;padding:9px 12px;background:transparent;color:var(--ft-ink);
        font-size:12px;cursor:pointer;font-family:inherit}
      #ft-panel button.ft-ghost:hover{background:var(--ft-tint)}
      #ft-panel .ft-note{margin-top:10px;padding:9px;border-radius:9px;background:var(--ft-tint);
        font-size:11px;color:var(--ft-ink);line-height:1.45;opacity:.85}
      #ft-panel .ft-ver{margin-top:10px;padding-top:9px;border-top:1px solid var(--ft-line);
        font-size:10px;color:var(--ft-soft);text-align:right;letter-spacing:.02em}
    `;
    document.documentElement.appendChild(el);
  }

  /* ---------------------------------------------------------------- */

  /**
   * Known row markup, newest first.
   *
   * LinkedIn ships several variants at once and retires old ones without notice
   * — `reusable-search__result-container` and `entity-result` were the search
   * result classes for years and are now gone from people search. Attribute
   * hooks (`data-view-name`, `data-chameleon-result-urn`) have outlived the
   * class names, so they lead.
   */
  const ROW_SELECTORS = [
    '[data-view-name="search-entity-result"]',
    "[data-chameleon-result-urn]",
    "li.reusable-search__result-container",
    "div.entity-result",
    "li.artdeco-list__item",
    ".scaffold-finite-scroll__content > ul > li",
  ];

  const isPerson = (el) => !!el.querySelector('a[href*="/in/"]');

  /**
   * Find rows without knowing any class names.
   *
   * This is the part that survives a redesign. A results list is the element
   * with the most sibling children that each contain exactly one distinct
   * profile link — a shape that holds regardless of what LinkedIn calls things
   * this quarter. Scoped to <main> so the "People you may know" rail and the
   * nav don't win.
   */
  function structuralCards() {
    const scope = document.querySelector("main") || document.body;
    const anchors = Array.from(scope.querySelectorAll('a[href*="/in/"]'));
    if (anchors.length < 3) return [];

    // For each anchor, register every ancestor against its parent, so each
    // parent accumulates the set of children that lead to a profile.
    const byParent = new Map();
    for (const a of anchors) {
      let node = a;
      for (let depth = 0; depth < 8 && node && node !== scope; depth++) {
        const parent = node.parentElement;
        if (!parent) break;
        if (!byParent.has(parent)) byParent.set(parent, new Set());
        byParent.get(parent).add(node);
        node = parent;
      }
    }

    let best = [];
    for (const children of byParent.values()) {
      const rows = Array.from(children).filter(isPerson);
      if (rows.length < 3) continue;
      // Each row should be a different person; a container whose children all
      // point at the same profile is a card's internals, not the list.
      const distinct = new Set(
        rows.map((r) => {
          const a = r.querySelector('a[href*="/in/"]');
          return a ? a.getAttribute("href").split("?")[0] : "";
        }),
      );
      if (distinct.size < rows.length) continue;
      if (rows.length > best.length) best = rows;
    }
    return best;
  }

  function rowCards() {
    for (const sel of ROW_SELECTORS) {
      const found = Array.from(document.querySelectorAll(sel)).filter(isPerson);
      if (found.length) return found;
    }
    return structuralCards();
  }

  /**
   * The rows we can actually read.
   *
   * Counting and extracting used to be different questions answered by different
   * functions: paint() counted rowCards(), and only addAllOnPage() ever called
   * rowData(). So the bar could promise "10 on this page" while all ten were
   * unreadable, and nothing found out until somebody pressed the button. One
   * function now answers both, so the number on screen is always a number we can
   * deliver.
   *
   * Memoised for a tick because rowCards() is a fresh DOM walk with a
   * first-match selector ladder and a max-by-count structural election — two
   * calls in the same frame are not guaranteed to return the same elements, and
   * paint() and decorate() must agree.
   */
  let readCache = null;
  function readableRows() {
    if (readCache) return readCache;
    const cards = rowCards();
    const pairs = [];
    for (const card of cards) {
      const data = rowData(card);
      if (data) pairs.push({ card, data });
    }
    readCache = { found: cards.length, pairs };
    // One frame: long enough for everything in this tick to see the same answer,
    // short enough that rows streaming in on scroll are picked up.
    setTimeout(() => { readCache = null; }, 0);
    return readCache;
  }

  /**
   * What the page looks like to us, for when it looks like nothing.
   *
   * scrapers.js states the rule this file was missing: a selector miss and an
   * empty result must not be indistinguishable. Copying this into a bug report
   * turns "the extension is broken" into a one-line selector fix.
   */
  function diagnostics() {
    const scope = document.querySelector("main") || document.body;
    const anchors = Array.from(scope.querySelectorAll('a[href*="/in/"]'));
    const sample = anchors[0] && anchors[0].closest("li, div[class]");
    return JSON.stringify(
      {
        url: location.href.split("?")[0],
        profileLinksOnPage: anchors.length,
        matchedSelector: ROW_SELECTORS.find(
          (sel) => Array.from(document.querySelectorAll(sel)).filter(isPerson).length,
        ) || null,
        structuralRows: structuralCards().length,
        sampleRowClass: sample ? sample.className || "(no class)" : null,
        extensionVersion: version(),
      },
      null,
      2,
    );
  }

  /**
   * LinkedIn's own result count, e.g. "About 2,300 results".
   *
   * Needed because a search page shows about ten people, so a bar that can only
   * take what is on screen is a nice touch rather than a prospecting tool. This
   * is what lets us offer the whole set.
   */
  function totalResults() {
    const el = document.querySelector(".search-results-container h2, .pb2.t-black--light, .search-results__total");
    const m = el && el.textContent ? el.textContent.replace(/[,\s]/g, "").match(/(\d+)result/i) : null;
    return m ? Number(m[1]) : null;
  }

  function rowData(card) {
    const a = card.querySelector('a[href*="/in/"]');
    if (!a) return null;
    let profileUrl;
    try {
      const u = new URL(a.getAttribute("href"), "https://www.linkedin.com");
      profileUrl = `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
    const grab = (sels) => {
      for (const s of sels) {
        const n = card.querySelector(s);
        const t = n && n.textContent ? n.textContent.trim().replace(/\s+/g, " ") : "";
        if (t) return t;
      }
      return "";
    };
    const raw = grab([
      "span.entity-result__title-text span[aria-hidden='true']",
      ".entity-result__title-text a span",
      "span[dir='ltr'] span[aria-hidden='true']",
      ".artdeco-entity-lockup__title",
      // Last resort: the profile link's own text. Three of the four selectors
      // above are class names this file's own comment calls dead, which left one
      // live path — and when the current markup stopped matching it, every row
      // returned null while rowCards() still counted ten. scrapers.js has always
      // had this line; content.js was a copy that dropped it.
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/in/"]',
    ]);
    const fullName = raw.replace(/\b(1st|2nd|3rd)\b/g, "").replace(/[·•|]/g, " ").replace(/\s+/g, " ").trim();
    if (!fullName) return null;

    // Degree decides what we can even do with someone — you can only message a
    // 1st-degree connection — so read it from the whole row, not just the name.
    // Modern markup puts it in a sibling span, older markup inlines it.
    const cardText = (card.textContent || "").replace(/\s+/g, " ");
    const degree = (cardText.match(/\b(1st|2nd|3rd)\b/) || [])[1] || "";

    /**
     * Headline and location when the labelled classes are gone.
     *
     * The name selectors were not the only casualties — `entity-result__*` is
     * dead for the subtitle rows too, which is why a row could come back with a
     * correct name and an empty company, quietly emptying {{company}} in every
     * template. LinkedIn's rows read top to bottom (name, headline, location),
     * so fall back to that order: take the card's leaf text blocks, drop the
     * ones that are the name, a degree marker, a screen-reader duplicate or a
     * button, and the first two survivors are what we want.
     */
    const blocks = [];
    for (const el of card.querySelectorAll("div, p, span, h3")) {
      if (el.querySelector("div, p, span, a, button")) continue; // leaves only
      if (el.closest("button")) continue;
      const t = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (t.length < 3) continue;
      if (t === fullName || t.startsWith(fullName)) continue; // name + a11y copy
      if (/^[·•|\s]*(1st|2nd|3rd)\+?[·•|\s]*$/i.test(t)) continue;
      if (!blocks.includes(t)) blocks.push(t);
    }

    const headline = grab([".entity-result__primary-subtitle", ".artdeco-entity-lockup__subtitle"]) || blocks[0] || "";
    const location = grab([".entity-result__secondary-subtitle", ".artdeco-entity-lockup__caption"]) || blocks[1] || "";
    const parts = fullName.split(/\s+/);

    /**
     * Never hand the server a value it will refuse.
     *
     * The structural fallback reads whole text blocks, so a headline can easily
     * be "Deputy Manager - Marketing | Influencer Marketing | Brand Management at
     * The Man Company. Ex-Ogilvy | Ex-FCB" — and `title`, derived from it, then
     * exceeded the API's 200-character limit and failed the ENTIRE import with
     * "String must contain at most 200 character(s)". Ten good leads lost to one
     * verbose profile.
     */
    const clamp = (s, n) => (s || "").slice(0, n).trim();

    // "Head of HR at Acme" -> company is what follows " at ". When there is no
    // " at ", the whole headline used to become the title; take the first
    // segment instead, which is the role rather than the person's entire pitch.
    const atSplit = headline.split(/\s+at\s+/i);
    const rawTitle = atSplit.length > 1 ? atSplit[0] : headline.split(/\s*[|·•]\s*/)[0];

    return {
      profileUrl: clamp(profileUrl, 500),
      fullName: clamp(fullName, 200),
      firstName: clamp(parts[0], 120),
      lastName: clamp(parts.slice(1).join(" "), 120),
      headline: clamp(headline, 500),
      location: clamp(location, 200),
      company: clamp(atSplit[1], 200),
      title: clamp(rawTitle, 200),
      degree: clamp(degree, 20),
    };
  }

  /* ---------------------------------------------------------------- */

  function bar() {
    let el = document.getElementById(BAR_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = BAR_ID;
    el.innerHTML = `
      <span class="ft-brand" data-ft="brand"><span class="ft-mark">F</span> Followthroo</span>
      <span class="ft-sep"></span>
      <button class="ft-link" data-ft="all">Select all</button>
      <span class="ft-count" data-ft="count">No one selected</span>
      <span class="ft-msg" data-ft="msg"></span>
      <button class="ft-link" data-ft="every" hidden></button>
      <button class="ft-link" data-ft="diag" hidden>Copy diagnostics</button>
      <button class="ft-primary" data-ft="add" disabled>Add to Followthroo</button>
    `;
    el.querySelector('[data-ft="brand"]').title = `Followthroo for LinkedIn v${version()}`;
    el.querySelector('[data-ft="all"]').addEventListener("click", toggleAll);
    el.querySelector('[data-ft="add"]').addEventListener("click", add);
    el.querySelector('[data-ft="every"]').addEventListener("click", addEveryPage);
    el.querySelector('[data-ft="diag"]').addEventListener("click", () => {
      navigator.clipboard.writeText(diagnostics()).then(
        () => message("Diagnostics copied — paste them into a bug report.", "ok"),
        () => message("Could not copy. Open the console: the details are logged there.", "err"),
      );
      console.log("[followthroo] diagnostics", diagnostics());
    });
    return el;
  }

  /**
   * Mount above the results list.
   *
   * It also mounts when NO rows were found, which is the point: previously a
   * selector miss meant the bar never appeared, so a broken extension and an
   * extension that had nothing to do looked identical — to the user and to us.
   * Now the page says which of the two it is.
   */
  function mountBar() {
    const cards = rowCards();

    if (!cards.length) {
      // Only complain where people are actually expected. A profile page or the
      // feed having no result rows is correct, not a failure.
      const scope = document.querySelector("main") || document.body;
      const looksLikeAList = scope.querySelectorAll('a[href*="/in/"]').length >= 3;
      if (!looksLikeAList || !scope.parentElement) return false;
      const el = bar();
      if (el.parentElement !== scope.parentElement) scope.parentElement.insertBefore(el, scope);
      return true;
    }

    const list = cards[0].closest("ul") || cards[0].parentElement;
    if (!list || !list.parentElement) return false;
    const el = bar();
    if (el.parentElement !== list.parentElement) list.parentElement.insertBefore(el, list);
    return true;
  }

  function paint() {
    const el = document.getElementById(BAR_ID);
    if (!el) return;
    const n = state.selected.size;
    const { found, pairs } = readableRows();
    const total = pairs.length;
    const diag = el.querySelector('[data-ft="diag"]');

    // Zero readable rows on a page full of profile links means we failed to read
    // it, not that the search found nobody. Naming both numbers is the whole
    // point: "0 of 10" says the rows are there and we are the problem.
    if (total === 0) {
      el.querySelector('[data-ft="count"]').textContent = found
        ? `Found ${found} people but couldn't read them — LinkedIn may have changed its layout.`
        : "Can't read this page's layout — LinkedIn may have changed it.";
      el.querySelector('[data-ft="all"]').hidden = true;
      el.querySelector('[data-ft="every"]').hidden = true;
      el.querySelector('[data-ft="add"]').hidden = true;
      diag.hidden = false;
      return;
    }
    el.querySelector('[data-ft="all"]').hidden = false;
    el.querySelector('[data-ft="add"]').hidden = false;
    diag.hidden = true;

    el.classList.toggle("ft-active", n > 0);
    el.querySelector('[data-ft="count"]').textContent =
      n === 0 ? `${total} on this page` : `${n} selected`;
    el.querySelector('[data-ft="all"]').textContent = n >= total && total > 0 ? "Clear selection" : "Select all";
    const btn = el.querySelector('[data-ft="add"]');
    btn.disabled = n === 0 || state.busy;
    btn.textContent = state.busy ? "Adding…" : n === 0 ? "Add to Followthroo" : `Add ${n} to Followthroo`;

    // Offered only when there is genuinely more than this page to get.
    const every = el.querySelector('[data-ft="every"]');
    const all = totalResults();
    if (all && all > total) {
      every.hidden = false;
      every.disabled = state.busy;
      every.textContent = `Add all ${all.toLocaleString()} results`;
    } else {
      every.hidden = true;
    }
  }

  function message(text, kind) {
    const el = document.getElementById(BAR_ID);
    if (!el) return;
    const m = el.querySelector('[data-ft="msg"]');
    m.textContent = text || "";
    m.className = `ft-msg ${kind === "err" ? "ft-err" : kind === "ok" ? "ft-ok" : ""}`;
    if (text) setTimeout(() => { if (m.textContent === text) m.textContent = ""; }, 6000);
  }

  /** A checkbox per row, positioned in the gutter so it never covers content. */
  function decorate() {
    const { pairs } = readableRows();
    const live = new Set(pairs.map((p) => p.card));

    // Drop checkboxes on rows we can no longer read. LinkedIn re-renders a row's
    // internals while our appended node survives, so a stale checkbox can sit on
    // a card whose name no longer extracts — tickable, and silently absent from
    // whatever gets sent. Previously decorate() short-circuited on the presence
    // of a checkbox before ever re-reading the row, so this went unnoticed.
    for (const box of document.querySelectorAll(`.${CHECK_CLASS}`)) {
      const card = box.closest(".ft-anchor");
      if (!card || !live.has(card)) {
        const stale = card && rowData(card);
        if (stale) state.selected.delete(stale.profileUrl);
        box.remove();
      }
    }

    for (const { card, data } of pairs) {
      if (card.querySelector(`.${CHECK_CLASS}`)) continue;
      card.classList.add("ft-anchor");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = CHECK_CLASS;
      box.title = `Add ${data.fullName} to Followthroo`;
      box.checked = state.selected.has(data.profileUrl);
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", () => {
        if (box.checked) state.selected.set(data.profileUrl, data);
        else state.selected.delete(data.profileUrl);
        paint();
      });
      card.appendChild(box);
    }
  }

  function toggleAll() {
    const { pairs } = readableRows();
    const all = state.selected.size >= pairs.length && pairs.length > 0;
    state.selected.clear();
    if (!all) {
      for (const { data } of pairs) state.selected.set(data.profileUrl, data);
    }
    document.querySelectorAll(`.${CHECK_CLASS}`).forEach((b) => { b.checked = !all; });
    paint();
  }

  /**
   * The whole result set, not just this page.
   *
   * Hands off to the background job rather than trying to paginate from here: a
   * content script dies the moment the person navigates, and losing 2,000 rows
   * at page 40 would be a miserable way to find that out.
   */
  async function addEveryPage() {
    if (state.busy) return;
    const cfg = await chrome.storage.local.get(["apiBase", "token"]);
    if (!cfg.apiBase || !cfg.token) {
      message("Connect the extension first — click its icon.", "err");
      return;
    }
    state.busy = true;
    paint();
    try {
      const res = await fetch(`${cfg.apiBase}/api/linkedin/scrape/collect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: location.href, allPages: true, estimated: totalResults() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `server said ${res.status}`);
      message(`Reading all ${json.data.maxResults} in the background — watch it in Followthroo`, "ok");
    } catch (e) {
      message(String((e && e.message) || e), "err");
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function add() {
    if (state.busy || state.selected.size === 0) return;
    const cfg = await chrome.storage.local.get(["apiBase", "token"]);
    if (!cfg.apiBase || !cfg.token) {
      message("Connect the extension first — click its icon.", "err");
      return;
    }
    state.busy = true;
    paint();

    const rows = Array.from(state.selected.values());
    try {
      const res = await fetch(`${cfg.apiBase}/api/linkedin/scrape/collect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: location.href, rows }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `server said ${res.status}`);

      const { created = 0, duplicates = 0 } = json.data || {};
      message(
        duplicates ? `Added ${created}, ${duplicates} already yours` : `Added ${created}`,
        "ok",
      );
      state.selected.clear();
      document.querySelectorAll(`.${CHECK_CLASS}`).forEach((b) => { b.checked = false; });
    } catch (e) {
      message(String((e && e.message) || e), "err");
    } finally {
      state.busy = false;
      paint();
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * The floating launcher.
   *
   * The bar only exists where there is a list to act on. That left a profile, a
   * company page, or any page we could not read with no visible sign the
   * extension was installed at all — indistinguishable from broken. This is
   * always present on LinkedIn, and it is the thing that says "we are here".
   *
   * It is draggable and its position is remembered, because a fixed overlay
   * will eventually sit on top of something the person needs.
   */

  const LAUNCHER_ID = "ft-launcher";
  const PANEL_ID = "ft-panel";

  /** Rough page classification from the URL alone — cheap and layout-proof. */
  function pageKind() {
    const p = location.pathname;
    if (p.startsWith("/in/")) return "profile";
    if (p.startsWith("/search/results/people")) return "search";
    if (p.startsWith("/company/")) return "company";
    if (p.startsWith("/groups/")) return "group";
    if (p.startsWith("/events/")) return "event";
    if (p.startsWith("/mynetwork")) return "network";
    return "other";
  }

  /** The person whose profile is open, read from the page. */
  function currentProfile() {
    if (pageKind() !== "profile") return null;
    const h1 = document.querySelector("main h1, h1");
    const fullName = h1 && h1.textContent ? h1.textContent.trim().replace(/\s+/g, " ") : "";
    if (!fullName) return null;
    const hEl = document.querySelector("main .text-body-medium, .pv-text-details__left-panel .text-body-medium");
    const headline = hEl && hEl.textContent ? hEl.textContent.trim().replace(/\s+/g, " ") : "";
    const parts = fullName.split(" ");
    return {
      profileUrl: "https://www.linkedin.com" + location.pathname.replace(/\/+$/, ""),
      fullName,
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" "),
      headline,
      company: (headline.split(/\s+at\s+/i)[1] || "").trim(),
      title: (headline.split(/\s+at\s+/i)[0] || headline).trim(),
    };
  }

  /** Send rows to Followthroo. Shared by the bar and the panel. */
  async function postRows(rows, onDone) {
    const cfg = await chrome.storage.local.get(["apiBase", "token"]);
    if (!cfg.apiBase || !cfg.token) return onDone("Connect the extension first — click its icon.", true);
    try {
      const res = await fetch(`${cfg.apiBase}/api/linkedin/scrape/collect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: location.href, rows }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `server said ${res.status}`);
      const { created = 0, duplicates = 0 } = json.data || {};
      onDone(duplicates ? `Added ${created}, ${duplicates} already yours` : `Added ${created}`, false);
    } catch (e) {
      onDone(String((e && e.message) || e), true);
    }
  }

  function mountLauncher() {
    if (document.getElementById(LAUNCHER_ID)) return;
    const el = document.createElement("div");
    el.id = LAUNCHER_ID;
    el.innerHTML = `
      <span class="ft-grip" data-ft="grip" title="Drag to move"></span>
      <button class="ft-open" data-ft="open" title="Followthroo">F<span class="ft-dot off" data-ft="dot"></span></button>
    `;
    document.body.appendChild(el);

    // Restore where they last put it.
    chrome.storage.local.get(["launcherTop"], (v) => {
      if (v && typeof v.launcherTop === "number") el.style.top = `${v.launcherTop}px`;
    });

    // Connected state, so the icon itself answers "is this thing on?".
    chrome.storage.local.get(["token", "apiBase"], (v) => {
      const dot = el.querySelector('[data-ft="dot"]');
      const on = !!(v && v.token && v.apiBase);
      dot.className = `ft-dot ${on ? "on" : "off"}`;
      dot.title = on ? "Connected to Followthroo" : "Not connected — click to set up";
    });

    el.querySelector('[data-ft="open"]').addEventListener("click", togglePanel);

    // Vertical drag only: it is docked to the right edge, and letting it roam
    // horizontally just creates ways to lose it.
    const grip = el.querySelector('[data-ft="grip"]');
    let startY = 0;
    let startTop = 0;
    grip.addEventListener("pointerdown", (e) => {
      startY = e.clientY;
      startTop = el.getBoundingClientRect().top;
      el.classList.add("ft-dragging");
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!el.classList.contains("ft-dragging")) return;
      const top = Math.max(8, Math.min(window.innerHeight - 50, startTop + (e.clientY - startY)));
      el.style.top = `${top}px`;
    });
    grip.addEventListener("pointerup", () => {
      if (!el.classList.contains("ft-dragging")) return;
      el.classList.remove("ft-dragging");
      chrome.storage.local.set({ launcherTop: el.getBoundingClientRect().top });
      closePanel();
    });
  }

  function closePanel() {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
  }

  function togglePanel() {
    if (document.getElementById(PANEL_ID)) return closePanel();

    const launcher = document.getElementById(LAUNCHER_ID);
    const box = launcher.getBoundingClientRect();
    const el = document.createElement("div");
    el.id = PANEL_ID;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - 240, box.top))}px`;
    el.style.right = "52px";

    const { found, pairs } = readableRows();
    const profile = currentProfile();
    const kind = pageKind();

    let bodyHtml;
    let action = null;

    if (pairs.length) {
      bodyHtml = `<h4>${pairs.length} people on this page</h4><p>Tick the ones you want, or take the lot.</p>`;
      action = { label: `Add all ${pairs.length}`, run: addAllOnPage };
    } else if (found) {
      // Rows are there; we just cannot read them. This is the case that used to
      // render "Add all 10" and then refuse.
      bodyHtml =
        `<h4>Found ${found}, read none</h4>` +
        `<p>The people are on the page but their layout has changed and we can't pull the names out.</p>` +
        `<div class="ft-note">Nothing was skipped quietly — copy the diagnostics and send them to us and this is usually a one-line fix.</div>`;
      action = { label: "Copy diagnostics", run: copyDiagnostics };
    } else if (profile) {
      bodyHtml = `<h4>${profile.fullName}</h4><p>${profile.headline || "Save this profile to Followthroo."}</p>`;
      action = { label: "Save this profile", run: saveCurrentProfile };
    } else if (kind === "search" || kind === "company" || kind === "group" || kind === "event") {
      bodyHtml =
        `<h4>Can't read this page</h4>` +
        `<p>This looks like it should list people, but LinkedIn's layout has changed and we can't find them.</p>` +
        `<div class="ft-note">Nothing was skipped silently — we would rather say so. Copy the diagnostics and send them to us.</div>`;
      action = { label: "Copy diagnostics", run: copyDiagnostics };
    } else {
      bodyHtml =
        `<h4>Nothing to add here</h4>` +
        `<p>Open a people search, a company's people, a group, an event, or someone's profile.</p>`;
    }

    el.innerHTML = `
      <div class="ft-head">
        <span class="ft-mark">F</span>
        <b>Followthroo</b>
        <button class="ft-x" data-ft="close" title="Close">&times;</button>
      </div>
      ${bodyHtml}
      ${action ? `<button class="ft-act" data-ft="act">${action.label}</button>` : ""}
      <button class="ft-ghost" data-ft="app">Open Followthroo</button>
      <div class="ft-msg" data-ft="pmsg" style="margin-top:8px;font-size:12px"></div>
      <!-- The running version, always visible.
           Chrome keeps serving the old content script to tabs that were already
           open when the extension reloaded, so a fixed bug can look unfixed with
           nothing on screen to contradict it. Costing one line here beats another
           round of "did you reload it?". -->
      <div class="ft-ver">v${version()}</div>
    `;
    document.body.appendChild(el);

    el.querySelector('[data-ft="close"]').addEventListener("click", closePanel);
    el.querySelector('[data-ft="app"]').addEventListener("click", async () => {
      const cfg = await chrome.storage.local.get(["apiBase"]);
      window.open(`${cfg.apiBase || "https://app.followthroo.com"}/dashboard/linkedin`, "_blank");
    });
    if (action) el.querySelector('[data-ft="act"]').addEventListener("click", action.run);
  }

  function panelMessage(text, isError) {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    const m = el.querySelector('[data-ft="pmsg"]');
    if (!m) return;
    m.textContent = text;
    m.style.color = isError ? "#b91c1c" : "#0f7b52";
  }

  function copyDiagnostics() {
    navigator.clipboard.writeText(diagnostics()).then(
      () => panelMessage("Copied. Paste it into a bug report.", false),
      () => panelMessage("Could not copy — details are in the console.", true),
    );
    console.log("[followthroo] diagnostics", diagnostics());
  }

  async function saveCurrentProfile() {
    const profile = currentProfile();
    if (!profile) return panelMessage("Could not read this profile.", true);
    panelMessage("Saving…", false);
    await postRows([profile], panelMessage);
  }

  async function addAllOnPage() {
    const { found, pairs } = readableRows();
    if (!pairs.length) {
      return panelMessage(
        found ? `Read 0 of ${found} rows — copy the diagnostics.` : "No people on this page.",
        true,
      );
    }
    panelMessage(`Adding ${pairs.length}…`, false);
    await postRows(pairs.map((p) => p.data), panelMessage);
  }

  /* ---------------------------------------------------------------- */

  /**
   * LinkedIn is a single-page app: navigating between searches replaces the
   * list without a page load, and results stream in as you scroll. So rather
   * than running once, watch and re-apply — debounced, because the feed mutates
   * constantly and re-scanning on every mutation would be its own performance bug.
   */
  let timer = null;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      applyTheme();
      styles();
      // The launcher mounts on every LinkedIn page, whether or not there is a
      // list here. It is the only thing that proves the extension is installed
      // and connected, so it must not depend on the bar succeeding.
      mountLauncher();
      if (mountBar()) {
        decorate();
        paint();
      }
    }, 400);
  }

  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
  refresh();
})();
