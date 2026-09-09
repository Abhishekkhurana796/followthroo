/**
 * Page readers, one per scrape kind.
 *
 * Every function here is injected into the rep's own logged-in LinkedIn tab and
 * returns plain rows. They read what is already on screen — the same thing the
 * person could select and copy by hand — and never click anything.
 *
 * Two rules that matter:
 *
 * 1. **Report a selector miss as a selector miss.** LinkedIn changes its markup
 *    often. "We found no rows because the page had none" and "we found no rows
 *    because we no longer know where to look" both produce zero results, and if
 *    they report identically then every breakage looks like a correct, quiet
 *    answer and nobody notices for months. Each reader decides which happened by
 *    checking whether the *container* it expected exists at all.
 *
 * 2. **Selectors are lists, not strings.** LinkedIn ships several markup
 *    variants at once (A/B tests, old and new profile layouts). Trying a few in
 *    order survives far longer than one clever selector.
 */

/** First selector that matches anything. */
function pick(root, selectors) {
  for (const sel of selectors) {
    const found = root.querySelectorAll(sel);
    if (found.length) return Array.from(found);
  }
  return [];
}

function text(el, selectors) {
  for (const sel of selectors) {
    const node = el.querySelector(sel);
    const t = node && node.textContent ? node.textContent.trim() : "";
    // LinkedIn duplicates label text for screen readers; the visible span wins.
    if (t) return t.replace(/\s+/g, " ");
  }
  return "";
}

/** Canonical profile URL: no query, no trailing slash, always absolute. */
function profileHref(el) {
  const a = el.querySelector('a[href*="/in/"]');
  if (!a) return "";
  try {
    const u = new URL(a.getAttribute("href"), "https://www.linkedin.com");
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function splitName(full) {
  const parts = (full || "").trim().split(/\s+/);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

/** LinkedIn appends "· 2nd" style degree markers to names. Strip and capture. */
function cleanName(raw) {
  const degree = (raw.match(/\b(1st|2nd|3rd)\b/) || [])[1] || "";
  const name = raw
    .replace(/\b(1st|2nd|3rd)\b/g, "")
    .replace(/[·•|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name, degree };
}

const CARD_SELECTORS = [
  // Attribute hooks first: these have outlived the class names, which LinkedIn
  // retires without notice. `reusable-search__result-container` and
  // `entity-result` were people-search staples for years and are now gone.
  '[data-view-name="search-entity-result"]',
  "[data-chameleon-result-urn]",
  "li.reusable-search__result-container",
  "div.entity-result",
  "li.artdeco-list__item",
  ".scaffold-finite-scroll__content li",
];

/**
 * Rows without class names.
 *
 * Rule 2 in this file's header says selectors should be lists, not strings.
 * This is the end of that list: the results container is whichever element has
 * the most sibling children that each hold one distinct profile link. That
 * shape is what a list of people IS, so it survives a redesign that renames
 * everything.
 */
function structuralCards(doc) {
  const scope = doc.querySelector("main") || doc.body;
  if (!scope) return [];
  if (scope.querySelectorAll('a[href*="/in/"]').length < 3) return [];

  const byParent = new Map();
  for (const a of scope.querySelectorAll('a[href*="/in/"]')) {
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
    const rows = Array.from(children).filter((c) => c.querySelector('a[href*="/in/"]'));
    if (rows.length < 3) continue;
    const distinct = new Set(rows.map((r) => profileHref(r)));
    if (distinct.size < rows.length) continue; // a card's internals, not the list
    if (rows.length > best.length) best = rows;
  }
  return best;
}

/**
 * A row's text lines, in reading order, minus the ones that are not content.
 *
 * The subtitle classes died with the title classes, so a row could come back
 * with a correct name and an empty company — quietly emptying {{company}} in
 * every template that used it. LinkedIn rows read name, then headline, then
 * location, so when the labelled selectors miss, fall back to that order.
 */
function leafBlocks(card, name) {
  const out = [];
  for (const el of card.querySelectorAll("div, p, span, h3")) {
    if (el.querySelector("div, p, span, a, button")) continue; // leaves only
    if (el.closest("button")) continue;
    const t = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (t.length < 3) continue;
    if (t === name || t.startsWith(name)) continue; // the name, and its a11y copy
    if (/^[·•|\s]*(1st|2nd|3rd)\+?[·•|\s]*$/i.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** People search, company employees, group members, event guests all render as person cards. */
function readPersonCards(doc) {
  let cards = pick(doc, CARD_SELECTORS);
  if (!cards.length) cards = structuralCards(doc);
  if (!cards.length) return { rows: null }; // container missing → selector miss

  const rows = [];
  for (const card of cards) {
    const url = profileHref(card);
    if (!url) continue;
    const raw =
      text(card, [
        "span.entity-result__title-text span[aria-hidden='true']",
        ".entity-result__title-text a span",
        "span[dir='ltr'] span[aria-hidden='true']",
        ".artdeco-entity-lockup__title",
      ]) ||
      // Last resort: the profile link's own text. A row whose name we cannot
      // read is not a row we can use, so this is the floor rather than a guess.
      text(card, ['a[href*="/in/"] span[aria-hidden="true"]', 'a[href*="/in/"]']);
    const { name, degree: inlineDegree } = cleanName(raw);
    if (!name) continue;

    // The degree lives in a sibling span in current markup rather than inside
    // the name, and it decides what we can do with someone — only a 1st-degree
    // connection can be messaged — so read the whole row if the name lacked it.
    const cardText = (card.textContent || "").replace(/\s+/g, " ");
    const degree = inlineDegree || (cardText.match(/\b(1st|2nd|3rd)\b/) || [])[1] || "";

    const blocks = leafBlocks(card, name);
    const headline =
      text(card, [
        ".entity-result__primary-subtitle",
        ".artdeco-entity-lockup__subtitle",
        ".t-14.t-black.t-normal",
      ]) || blocks[0] || "";
    rows.push({
      profileUrl: url,
      fullName: name,
      ...splitName(name),
      headline,
      location:
        text(card, [".entity-result__secondary-subtitle", ".artdeco-entity-lockup__caption"]) ||
        blocks[1] ||
        "",
      // "Head of HR at Acme" → company is what follows " at ".
      company: (headline.split(/\s+at\s+/i)[1] || "").trim(),
      title: (headline.split(/\s+at\s+/i)[0] || headline).trim(),
      degree,
    });
  }
  return { rows };
}

const READERS = {
  search_export: readPersonCards,
  company_employees: readPersonCards,
  group_members: readPersonCards,
  event_guests: readPersonCards,

  connections_export(doc) {
    const cards = pick(doc, ["li.mn-connection-card", "li.reusable-search__result-container", ".mn-connections li"]);
    if (!cards.length) return { rows: null };
    const rows = [];
    for (const card of cards) {
      const url = profileHref(card);
      const raw = text(card, [".mn-connection-card__name", "span.entity-result__title-text span[aria-hidden='true']"]);
      const { name, degree } = cleanName(raw);
      if (!url || !name) continue;
      const headline = text(card, [".mn-connection-card__occupation", ".entity-result__primary-subtitle"]);
      rows.push({
        profileUrl: url,
        fullName: name,
        ...splitName(name),
        headline,
        company: (headline.split(/\s+at\s+/i)[1] || "").trim(),
        title: (headline.split(/\s+at\s+/i)[0] || headline).trim(),
        degree: degree || "1st",
      });
    }
    return { rows };
  },

  post_engagers(doc) {
    // Reactions and comments live in different containers on the same page.
    const reactors = pick(doc, [
      ".social-details-reactors-tab-body li",
      ".artdeco-modal__content li.reaction-item",
      ".social-details-reactors-modal__content li",
    ]);
    const comments = pick(doc, ["article.comments-comment-item", ".comments-comment-item"]);
    if (!reactors.length && !comments.length) return { rows: null };

    const rows = [];
    for (const el of reactors) {
      const url = profileHref(el);
      const { name, degree } = cleanName(text(el, ["span[aria-hidden='true']", ".artdeco-entity-lockup__title"]));
      if (!url || !name) continue;
      rows.push({
        profileUrl: url,
        fullName: name,
        ...splitName(name),
        headline: text(el, [".artdeco-entity-lockup__subtitle", ".t-14"]),
        degree,
        reaction: "reacted",
      });
    }
    for (const el of comments) {
      const url = profileHref(el);
      const { name, degree } = cleanName(text(el, [".comments-post-meta__name-text", "span[aria-hidden='true']"]));
      if (!url || !name) continue;
      rows.push({
        profileUrl: url,
        fullName: name,
        ...splitName(name),
        headline: text(el, [".comments-post-meta__headline", ".t-12"]),
        degree,
        reaction: "commented",
        comment: text(el, [".comments-comment-item__main-content", ".update-components-text"]),
      });
    }
    return { rows };
  },

  profile_scrape(doc) {
    const top = doc.querySelector("section.pv-top-card, .ph5.pb5, main section");
    if (!top) return { rows: null };
    const raw = text(top, ["h1.text-heading-xlarge", "h1"]);
    const { name } = cleanName(raw);
    if (!name) return { rows: null };
    const headline = text(top, [".text-body-medium.break-words", ".pv-text-details__left-panel .text-body-medium"]);
    return {
      rows: [
        {
          profileUrl: `https://www.linkedin.com${location.pathname.replace(/\/+$/, "")}`,
          fullName: name,
          ...splitName(name),
          headline,
          location: text(top, [".text-body-small.inline.t-black--light", ".pv-text-details__left-panel .t-black--light"]),
          company: text(doc, ["[aria-label='Current company'] span", ".pv-text-details__right-panel-item-text"]) ||
            (headline.split(/\s+at\s+/i)[1] || "").trim(),
          title: (headline.split(/\s+at\s+/i)[0] || headline).trim(),
        },
      ],
    };
  },

  company_scrape(doc) {
    const top = doc.querySelector(".org-top-card, section.artdeco-card");
    if (!top) return { rows: null };
    const name = text(top, ["h1", ".org-top-card-summary__title"]);
    if (!name) return { rows: null };
    const dl = Array.from(doc.querySelectorAll(".org-page-details__definition-text, .org-about-module__metadata"));
    const grab = (label) => {
      const dt = Array.from(doc.querySelectorAll("dt, h3")).find((n) =>
        (n.textContent || "").toLowerCase().includes(label),
      );
      const dd = dt && dt.nextElementSibling;
      return dd && dd.textContent ? dd.textContent.trim().replace(/\s+/g, " ") : "";
    };
    return {
      rows: [
        {
          company: name,
          profileUrl: `https://www.linkedin.com${location.pathname.replace(/\/+$/, "")}`,
          headline: text(top, [".org-top-card-summary__tagline", ".org-top-card-summary-info-list"]),
          website: grab("website"),
          industry: grab("industry"),
          companySize: grab("company size"),
          location: grab("headquarters"),
          founded: grab("founded"),
          about: (dl[0] && dl[0].textContent ? dl[0].textContent.trim() : "").slice(0, 2000),
        },
      ],
    };
  },

  activity_extract(doc) {
    const posts = pick(doc, [".feed-shared-update-v2", ".occludable-update", "div[data-urn]"]);
    if (!posts.length) return { rows: null };
    const rows = [];
    for (const p of posts) {
      const body = text(p, [".update-components-text", ".feed-shared-text"]);
      if (!body) continue;
      const urn = p.getAttribute("data-urn") || "";
      rows.push({
        postText: body.slice(0, 4000),
        postUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : location.href,
        profileUrl: `https://www.linkedin.com${location.pathname.split("/recent-activity")[0]}`,
      });
    }
    return { rows };
  },
};

/**
 * Run the reader for `kind` against the current document.
 *
 * Returns `{ rows }` on success, or `{ failureKind: "selector_miss" }` when the
 * container we expected is not there at all — which is the signal that LinkedIn
 * changed and we need to fix a selector, as distinct from a page that is simply
 * empty.
 */
function scrapeCurrentPage(kind) {
  const reader = READERS[kind];
  if (!reader) return { failureKind: "error", error: `No reader for ${kind}` };
  try {
    const { rows } = reader(document);
    if (rows === null) return { failureKind: "selector_miss" };
    if (!rows.length) return { rows: [], failureKind: "empty" };
    return { rows };
  } catch (e) {
    return { failureKind: "error", error: String((e && e.message) || e).slice(0, 300) };
  }
}

// Loaded with chrome.scripting.executeScript({ files: [...] }), which runs the
// file in the page's isolated world but returns nothing useful — so the entry
// point is hung off `window` for the follow-up executeScript({ func }) call to
// find. (A bare trailing expression would only work for the `func` form.)
window.__ftScrape = scrapeCurrentPage;
