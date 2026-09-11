/**
 * Verification for the extension's in-page bar (extension/content.js).
 *
 * Loads the real content script into Chromium against small LinkedIn-shaped
 * pages, with `chrome.*` stubbed, and checks what was reported on 2026-09-10 plus
 * what the same release added:
 *
 *   - the feed gets the launcher and nothing else — no "can't read" bar over it
 *   - on a people search the bar sits in flow, and never over a result
 *   - Connections cards that lead with a photo-only link are still read
 *   - chip text is never read back as somebody's headline
 *   - a profile gets a chip beside its name
 *   - on Connections, the people shown are reported so accepted invitations can
 *     be marked — and nothing is reported from any other page
 *
 *   npx tsx scripts/verify-extension-content.ts
 *
 * No network and no database: every request is answered by page.route.
 *
 * CONTENT_JS=<path> runs the same checks against another build — point it at an
 * older content.js to confirm a check fails where the bug still exists, which is
 * the only proof it is testing anything.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Locator } from "@playwright/test";

const CONTENT = fs.readFileSync(process.env.CONTENT_JS || path.join(process.cwd(), "extension", "content.js"), "utf8");
const APP = "https://app.followthroo.test";
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
  if (cond) pass++;
  else fail++;
};

/**
 * Reads and clicks without Playwright's 30-second auto-wait. A missing element
 * has to be a FAIL line: against an older build it used to hang, then throw, and
 * take every later check down with it.
 */
const quick = { timeout: 1500 };
const text = (loc: Locator) => loc.textContent(quick).catch(() => null);
const attr = (loc: Locator, name: string) => loc.getAttribute(name, quick).catch(() => null);
const click = (loc: Locator) => loc.click(quick).then(() => true, () => false);
const box = (loc: Locator) => loc.boundingBox(quick).catch(() => null);

/** LinkedIn's shape where it matters: a sticky header, and <main> as a grid cell. */
const shell = (main: string) => `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#fff;font-family:sans-serif">
  <header style="height:52px;position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;z-index:500">LinkedIn</header>
  <div style="display:grid;grid-template-columns:220px 1fr 280px;gap:24px;max-width:1128px;margin:0 auto">
    <aside>left rail</aside>
    <main style="min-height:2400px">${main}</main>
    <aside>right rail</aside>
  </div>
</body></html>`;

const PEOPLE: [slug: string, name: string, headline: string, location: string][] = [
  ["lianne-mui", "Lianne Mui", "Brand Building | Modern Marketing", "Singapore"],
  ["leannemui", "Leanne Mui", "Financial Services Professional", "Hong Kong SAR"],
  ["priya-shah", "Priya Shah", "Head of HR at Acme", "Mumbai"],
  ["arjun-mehta", "Arjun Mehta", "Talent Lead at Globex", "Pune"],
  ["sara-khan", "Sara Khan", "Recruiter at Initech", "Delhi"],
];

/** A people search in current markup: no known class names, the name inside the link. */
const SEARCH = shell(`
  <h2>About 2,300 results</h2>
  <ul style="list-style:none;padding:0">${PEOPLE.map(
    ([slug, name, headline, location]) => `
    <li style="border-bottom:1px solid #eee">
      <div style="padding:12px 12px 12px 40px;display:flex;gap:12px">
        <a href="https://www.linkedin.com/in/${slug}/"><img alt="" src="${PIXEL}" width="48" height="48"></a>
        <div>
          <a href="https://www.linkedin.com/in/${slug}/"><span aria-hidden="true">${name}</span></a> <span>• 3rd+</span>
          <div>${headline}</div>
          <div>${location}</div>
        </div>
        <button>Connect</button>
      </div>
    </li>`,
  ).join("")}
  </ul>`);

/**
 * A virtualised results list: each row is an inner flex div — the element our
 * selectors actually match — one level inside a `position: absolute` outer
 * wrapper the windowing library owns, all siblings inside a relatively-
 * positioned spacer. That extra wrapper level is what "insert before
 * `cards[0]`'s own parent" got wrong: `cards[0].parentElement` resolved to
 * the *absolutely positioned* wrapper, not the spacer, so the old code's
 * `list.parentElement.insertBefore(el, list)` landed the bar one level too
 * deep — as a normal-flow sibling *inside the spacer*, before the first
 * wrapper. A normal-flow element doesn't get pushed anywhere by an absolutely
 * positioned sibling — and isn't pushed *out of the way* by one either — so
 * it rendered at the spacer's own flow top, exactly where the first
 * absolutely-positioned row already sat: the same overlap reported live,
 * scoped down to the two rules of CSS that cause it.
 */
const SEARCH_VIRTUALIZED = shell(`
  <div style="padding:8px 0"><span>People</span> <span>Actively hiring</span> <span>1st</span> <span>2nd</span></div>
  <h2>About 2,300 results</h2>
  <div style="position:relative;height:${PEOPLE.length * 84}px">${PEOPLE.map(
    ([slug, name, headline, location], i) => `
    <div style="position:absolute;top:${i * 84}px;left:0;right:0;height:80px">
      <div style="display:flex;gap:12px">
        <a href="https://www.linkedin.com/in/${slug}/"><img alt="" src="${PIXEL}" width="48" height="48"></a>
        <div>
          <a href="https://www.linkedin.com/in/${slug}/"><span aria-hidden="true">${name}</span></a> <span>• 3rd+</span>
          <div>${headline}</div>
          <div>${location}</div>
        </div>
        <button>Connect</button>
      </div>
    </div>`,
  ).join("")}</div>`);

/**
 * Connections as reported: every card leads with a photo-only link to the same
 * profile. No whitespace between the headline and "Connected on", as on a
 * rendered page — so the card's text runs together ("MarketingConnected on"),
 * which is exactly what a word-boundary match used to miss.
 */
const CONNECTIONS = shell(`
  <section>
  ${PEOPLE.map(
    ([slug, name, headline]) => `
    <div class="_9214eeec _904777d2" style="display:flex;gap:12px;padding:12px">
      <a href="/in/${slug}/"><div><img alt="" src="${PIXEL}" width="56" height="56"></div></a>
      <div>
        <a href="/in/${slug}/"><p>${name}</p><p>${headline}</p></a><p>Connected on 8 September 2026</p>
      </div>
      <button>Message</button>
    </div>`,
  ).join("")}
  </section>`);

/** The feed: a profile link on every post, which the old bar took for a list. */
const FEED = shell(
  [...PEOPLE, ...PEOPLE]
    .map(
      ([slug, name]) => `
    <article style="border:1px solid #ddd;margin:8px 0;padding:12px">
      <a href="https://www.linkedin.com/in/${slug}/">${name}</a> posted this
      <p>It’s a wild but beautiful ride</p>
    </article>`,
    )
    .join(""),
);

const PROFILE = (name: string, headline: string) =>
  shell(`<section><h1>${name}</h1><div class="text-body-medium">${headline}</div><button>Connect</button></section>`);

const CHROME_STUB = `
  window.chrome = {
    runtime: { getManifest: () => ({ version: "3.1.0-verify" }) },
    storage: { local: {
      _v: { apiBase: ${JSON.stringify(APP)}, token: "tok_verify" },
      get(keys, cb) {
        const v = {};
        for (const k of [].concat(keys)) if (k in this._v) v[k] = this._v[k];
        if (cb) cb(v);
        return Promise.resolve(v);
      },
      set(obj) { Object.assign(this._v, obj); return Promise.resolve(); },
    } },
  };`;

type Row = { profileUrl: string; fullName: string; headline: string; location: string };

async function open(browser: Browser, url: string, html: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const lookups: string[][] = [];
  const collected: Row[] = [];
  const seen: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.addInitScript(CHROME_STUB);
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const json = (body: unknown) => ({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(body) });

  await page.route(`${APP}/api/linkedin/lookup`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const { urls } = route.request().postDataJSON() as { urls: string[] };
    lookups.push(urls);
    const results = Object.fromEntries(
      urls.map((u) => [u, /priya-shah/.test(u) ? { inCrm: true, leadId: "lead_123" } : { inCrm: false, leadId: null }]),
    );
    return route.fulfill(json({ ok: true, data: { results } }));
  });
  await page.route(`${APP}/api/linkedin/scrape/collect`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON() as { rows?: Row[] };
    collected.push(...(body.rows ?? []));
    return route.fulfill(json({ ok: true, data: { created: body.rows?.length ?? 0, duplicates: 0 } }));
  });
  await page.route(`${APP}/api/linkedin/connections/seen`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON() as { profileUrls?: string[] };
    seen.push(...(body.profileUrls ?? []));
    return route.fulfill(json({ ok: true, data: { matched: 0 } }));
  });
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));

  await page.goto(url);
  await page.addScriptTag({ content: CONTENT });
  await page.waitForTimeout(900); // content.js debounces its first pass by 400ms
  return { page, lookups, collected, seen, errors, close: () => context.close() };
}

type Box = { x: number; y: number; width: number; height: number } | null;
const overlaps = (a: Box, b: Box) =>
  !!a && !!b && a.y < b.y + b.height && a.y + a.height > b.y && a.x < b.x + b.width && a.x + a.width > b.x;

async function main() {
  const browser = await chromium.launch();
  try {
    // ---- feed ----------------------------------------------------------------
    console.log("feed");
    {
      const t = await open(browser, "https://www.linkedin.com/feed/", FEED);
      ok((await t.page.locator("#ft-bar").count()) === 0, "no bar on the feed", "(it used to cover the page)");
      ok((await t.page.locator("#ft-launcher").count()) === 1, "the launcher is still there");
      ok(t.seen.length === 0, "nobody on the feed is reported as a connection", String(t.seen.length));
      ok(t.errors.length === 0, "no script errors", t.errors.join(" | "));
      await t.close();
    }

    // ---- people search ---------------------------------------------------------
    console.log("people search");
    {
      const t = await open(browser, "https://www.linkedin.com/search/results/people/?keywords=mui", SEARCH);
      const bar = t.page.locator("#ft-bar");
      ok((await bar.count()) === 1, "bar is mounted");
      const position = (await bar.count()) ? await bar.evaluate((el) => getComputedStyle(el).position) : "(no bar)";
      ok(position !== "sticky" && position !== "fixed", "bar sits in flow", position);
      const count = (await text(t.page.locator("#ft-bar [data-ft='count']"))) ?? "";
      ok(count.includes("5 on this page"), "all five rows are readable", count);

      // Scroll far enough that a sticky bar would sit on top of the list, then
      // check it against every row. Checking only the first gave a false pass:
      // by then the first row has scrolled away from under the bar.
      await t.page.mouse.wheel(0, 320);
      await t.page.waitForTimeout(250);
      const barBox = await box(bar);
      const rowBoxes = await Promise.all((await t.page.locator("main li").all()).map((li) => box(li)));
      const covered = rowBoxes.filter((b) => overlaps(barBox, b)).length;
      ok(covered === 0, "after scrolling, the bar covers no result", `${covered} covered`);

      await t.page.waitForSelector(".ft-chip", { timeout: 4000 }).catch(() => null);
      ok(t.lookups.length === 1 && t.lookups[0].length === 5, "one lookup for the five people", JSON.stringify(t.lookups.map((l) => l.length)));
      const inChip = t.page.locator(".ft-chip.ft-in");
      ok((await inChip.count()) === 1, "the known person is marked In Followthroo");
      ok((await attr(inChip, "href")) === `${APP}/dashboard/leads/lead_123`, "and the chip opens their lead");
      ok((await t.page.locator(".ft-chip.ft-out").count()) === 4, "the other four are marked Not in Followthroo");

      // Re-read every row now that chips are on the page, then send them.
      await click(t.page.locator("#ft-bar [data-ft='all']"));
      const badge = (await text(t.page.locator("#ft-launcher [data-ft='badge']"))) ?? "(no badge)";
      ok(badge === "5", "the launcher counts the selection", badge);
      await click(t.page.locator("#ft-bar [data-ft='add']"));
      await t.page.waitForTimeout(500);
      ok(t.collected.length === 5, "Add sends all five", String(t.collected.length));
      ok(
        t.collected.every((r) => !JSON.stringify(r).includes("Followthroo")),
        "no chip text leaks into a row",
        JSON.stringify(t.collected.map((r) => r.headline)),
      );
      const lianne = t.collected.find((r) => r.fullName === "Lianne Mui");
      ok(lianne?.headline === "Brand Building | Modern Marketing", "headlines read correctly", lianne?.headline ?? "(missing)");
      ok(t.seen.length === 0, "search results are not reported as connections", String(t.seen.length));
      ok(t.errors.length === 0, "no script errors", t.errors.join(" | "));
      await t.close();
    }

    // ---- virtualised search results ---------------------------------------------
    // Guards the property "insert before the list" gave up on being able to
    // guarantee: a plain sibling inserted next to rows that are themselves
    // `position: absolute` (a windowed/virtual-scroll list — LinkedIn's own
    // results, on at least some layouts) does nothing to move them, so the
    // only placement immune to this is outside the list's container entirely.
    console.log("virtualised search results (rows position: absolute)");
    {
      const t = await open(browser, "https://www.linkedin.com/search/results/people/?keywords=marketing", SEARCH_VIRTUALIZED);
      const bar = t.page.locator("#ft-bar");
      ok((await bar.count()) === 1, "bar is mounted");
      const barBox = await box(bar);
      const rowBoxes = await Promise.all(
        (await t.page.locator('main div[style*="position:absolute"]').all()).map((r) => box(r)),
      );
      ok(rowBoxes.length === PEOPLE.length, "found every virtualised row", String(rowBoxes.length));
      const covered = rowBoxes.filter((b) => overlaps(barBox, b)).length;
      ok(covered === 0, "the bar does not overlap a single absolutely-positioned row", `${covered} covered`);
      const firstRowTop = rowBoxes[0]?.y ?? -1;
      const barBottom = barBox ? barBox.y + barBox.height : -1;
      ok(
        barBottom >= 0 && firstRowTop >= barBottom,
        "the bar renders entirely above the first row, not into the list itself",
        `bar bottom ${barBottom}, first row top ${firstRowTop}`,
      );
      ok(t.errors.length === 0, "no script errors", t.errors.join(" | "));
      await t.close();
    }

    // ---- connections -----------------------------------------------------------
    console.log("connections");
    {
      const t = await open(browser, "https://www.linkedin.com/mynetwork/invite-connect/connections/", CONNECTIONS);
      const count = (await text(t.page.locator("#ft-bar [data-ft='count']"))) ?? "(no bar)";
      ok(count.includes("5 on this page"), "photo-first cards are read", count);
      ok(await t.page.locator("#ft-bar [data-ft='diag']").isHidden(), "no \"copy diagnostics\" — nothing failed");
      await t.page.waitForTimeout(400);
      ok(
        t.seen.length === 5 && t.seen.every((u) => u.startsWith("https://www.linkedin.com/in/")),
        "everyone shown is reported once, so accepted invitations can be marked",
        JSON.stringify(t.seen),
      );
      await click(t.page.locator("#ft-bar [data-ft='all']"));
      await click(t.page.locator("#ft-bar [data-ft='add']"));
      await t.page.waitForTimeout(500);
      const names = t.collected.map((r) => r.fullName);
      ok(JSON.stringify(names) === JSON.stringify(PEOPLE.map((p) => p[1])), "every name comes through", JSON.stringify(names));
      ok(
        t.collected.length > 0 && t.collected.every((r) => !/connected on/i.test(r.headline) && !/connected on/i.test(r.location)),
        "\"Connected on …\" is not taken for a headline or location",
        JSON.stringify(t.collected.map((r) => [r.headline, r.location])),
      );
      ok(t.collected[0]?.headline === PEOPLE[0][2], "the headline is the headline", t.collected[0]?.headline ?? "(missing)");
      ok(t.seen.length === 5, "re-renders do not report the same people again", String(t.seen.length));
      ok(t.errors.length === 0, "no script errors", t.errors.join(" | "));
      await t.close();
    }

    // ---- profiles --------------------------------------------------------------
    console.log("profiles");
    {
      const t = await open(browser, "https://www.linkedin.com/in/priya-shah/", PROFILE("Priya Shah", "Head of HR at Acme"));
      await t.page.waitForSelector(".ft-chip-profile", { timeout: 4000 }).catch(() => null);
      ok((await t.page.locator("#ft-bar").count()) === 0, "no bar on a profile");
      const chip = t.page.locator(".ft-chip-profile");
      ok(((await attr(chip, "class")) ?? "").includes("ft-in"), "a known profile says In Followthroo");
      ok((await attr(chip, "href")) === `${APP}/dashboard/leads/lead_123`, "and links to the lead");
      const sibling = (await chip.count()) ? await chip.evaluate((el) => el.previousElementSibling?.tagName) : "(no chip)";
      ok(sibling === "H1", "the chip sits beside the name", String(sibling));
      await t.close();
    }
    {
      const t = await open(browser, "https://www.linkedin.com/in/sara-khan/", PROFILE("Sara Khan", "Recruiter at Initech"));
      await t.page.waitForSelector(".ft-chip-profile", { timeout: 4000 }).catch(() => null);
      const chip = t.page.locator(".ft-chip-profile");
      ok(((await attr(chip, "class")) ?? "").includes("ft-out"), "an unknown profile says Not in Followthroo");
      await click(chip.locator(".ft-chip-add"));
      await t.page.waitForTimeout(500);
      ok(t.collected.length === 1 && t.collected[0].fullName === "Sara Khan", "its Add button saves that profile", JSON.stringify(t.collected));
      ok(t.lookups.length >= 2, "and the chip is re-checked afterwards", String(t.lookups.length));
      ok(t.errors.length === 0, "no script errors", t.errors.join(" | "));
      await t.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
