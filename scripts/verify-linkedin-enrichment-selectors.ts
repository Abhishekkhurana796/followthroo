/**
 * Fixtures for the desktop enrichment reader: the profile-degree safety gate,
 * and the Contact info overlay it has to read once that gate passes.
 *
 * The overlay fixtures below are modelled on what LinkedIn actually renders —
 * an accessible dialog whose rows are a label node and a value node in their
 * own nested spans — not on what the reader happens to look for. The version
 * of this file these replace did the opposite: its markup was
 * `<h2>Contact info</h2><p>Email</p>`, single-word labels shaped to satisfy the
 * exact-string test the reader was using. It passed for five releases while
 * every real lookup failed, because a fixture written from the implementation
 * can only ever confirm the implementation.
 */
import assert from "node:assert/strict";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { readContactInfo } from "../desktop/page-actions";
import { observe } from "../desktop/pilot-page";

type Result = {
  status: string;
  state?: string;
  degree?: string;
  evidence?: string;
  email?: string | null;
  phone?: string | null;
  result?: string;
  fatal?: boolean;
  reasonCode?: string;
  extra?: { websites?: string[]; connectedSince?: string | null; im?: string[]; strategy?: string };
  diagnostics?: { html?: string | null; overlayState?: string; visibleDialogCount?: number };
};

let checks = 0;
const check = (fn: () => void) => {
  fn();
  checks++;
};

const pageFor = (degreeMarkup: string) => `<!doctype html><main>
  <div data-view-name="profile-top-card"><div><h1>Asha Rao</h1><a href="/in/asha-rao/overlay/contact-info/">Contact info</a>${degreeMarkup}</div></div>
</main>`;

/**
 * The live modal's shape: a dialog, a heading, and one section per row whose
 * label and value are separate nested elements — so the row's combined text
 * reads "Emailapurva@example.com" and cannot be matched as a whole.
 */
const OVERLAY_ROWS = `
  <section><h3><span aria-hidden="true">Apurva’s profile</span></h3><a href="https://www.linkedin.com/in/apurvakhedikar">linkedin.com/in/apurvakhedikar</a></section>
  <section><h3><span aria-hidden="true">Email</span></h3><a href="mailto:apurvakhedikar24@gmail.com">apurvakhedikar24@gmail.com</a></section>
  <section><h3><span aria-hidden="true">Website</span></h3><a href="https://apurva.example.com">apurva.example.com</a></section>
  <section><h3><span aria-hidden="true">IM</span></h3><span><span>apurvakhedikar24</span> <span>(Google Hangouts)</span></span></section>
  <section><h3><span aria-hidden="true">Connected since</span></h3><span>Sep 11, 2026</span></section>`;

const overlayPage = (inner: string) => `<!doctype html><main>
  <div data-view-name="profile-top-card"><h1>Apurva Gurav</h1><span>1st</span><a href="/in/apurvakhedikar/overlay/contact-info/">Contact info</a></div>
</main>${inner}`;

const DIALOG = (rows: string) => `<div role="dialog" aria-modal="true">
  <h2><span aria-hidden="true">Contact info</span><span class="visually-hidden">Contact info</span></h2>${rows}
</div>`;

async function main() {
  const browser: Browser = await chromium.launch();
  const ctx: BrowserContext = await browser.newContext();
  try {
    const run = async (html: string, options: Record<string, unknown> = { eligibilityOnly: true }) => {
      const page = await ctx.newPage();
      await page.setContent(html);
      const result = (await page.evaluate(readContactInfo, options)) as Result;
      await page.close();
      return result;
    };
    const readOverlay = (html: string) => run(html, { confirmedFirstDegree: true });
    const readOverlay2 = (html: string, options: Record<string, unknown>) => run(html, options);

    /* ---- the degree safety gate (unchanged behaviour) ------------------- */

    const modernFirst = await run(pageFor('<span class="pv-member-badge" aria-label="1st degree connection">1st</span>'));
    check(() => assert.equal(modernFirst.status, "eligible"));
    check(() => assert.equal(modernFirst.degree, "1st"));
    check(() => assert.match(String(modernFirst.evidence), /profile (header )?badge/i));

    // Current LinkedIn profile headers use a plain text degree beside pronouns,
    // not necessarily the old .pv-member-badge class.
    const headerFirst = await run(`<!doctype html><main>
      <div data-view-name="profile-top-card"><div><h1>Apurva Gurav</h1><span>She/Her</span><span>1st</span><a href="/in/apurva-gurav/overlay/contact-info/">Contact info</a></div></div>
      <aside><span>1st</span></aside>
    </main>`);
    check(() => assert.equal(headerFirst.status, "eligible"));
    check(() => assert.match(String(headerFirst.evidence), /profile header badge/i));

    // Enrichment begins with the same observer and persistent Playwright flow
    // as invitation sending, so it must recognise this header too.
    const observedPage = await ctx.newPage();
    await observedPage.setContent(`<!doctype html><main>
      <div data-view-name="profile-top-card"><div><h1>Apurva Gurav</h1><span>She/Her</span><span>1st</span><button>Message</button><button>More</button></div></div>
    </main>`);
    const observed = await observedPage.evaluate(observe);
    await observedPage.close();
    check(() => assert.equal(observed.connectionDegree.degree, "1st"));

    const removeConnection = await run(pageFor('<button aria-label="Remove Connection">Remove Connection</button>'));
    check(() => assert.equal(removeConnection.status, "eligible"));
    check(() => assert.match(String(removeConnection.evidence), /Remove Connection/));

    const second = await run(pageFor('<span class="distance-badge">2nd</span>'));
    check(() => assert.equal(second.status, "skipped"));
    check(() => assert.equal(second.reasonCode, "degree_not_first"));

    const stale = await run(pageFor('<div class="old-degree-widget">Connected?</div>'));
    check(() => assert.equal(stale.status, "skipped"));
    check(() => assert.equal(stale.reasonCode, "degree_unverified"));

    /* ---- the overlay ---------------------------------------------------- */

    // 1. The live shape: a dialog whose labels and values are separate nested
    //    nodes. This is the case every shipped release so far got wrong.
    const live = await readOverlay(overlayPage(DIALOG(OVERLAY_ROWS)));
    check(() => assert.equal(live.status, "done"));
    check(() => assert.equal(live.email, "apurvakhedikar24@gmail.com"));
    check(() => assert.equal(live.result, "found"));
    check(() => assert.equal(live.extra?.connectedSince, "Sep 11, 2026"));
    check(() => assert.deepEqual(live.extra?.im, ["apurvakhedikar24 (Google Hangouts)"]));
    // The person's own profile row is a linkedin.com link, not a website they
    // listed — the previous reader reported it as one.
    check(() => assert.deepEqual(live.extra?.websites, ["https://apurva.example.com"]));

    // 2. A phone given only as a tel: link, with no legacy .ci-phone class
    //    anywhere — the only path the old reader had for phones.
    const withPhone = await readOverlay(
      overlayPage(DIALOG(`<section><h3><span>Phone</span></h3><a href="tel:+919876543210">+91 98765 43210</a></section>`)),
    );
    check(() => assert.equal(withPhone.status, "done"));
    check(() => assert.equal(withPhone.phone, "+919876543210"));

    // 3. No dialog role at all — a plain container. The heading plus one
    //    labelled row still has to be enough to find it.
    const plain = await readOverlay(
      overlayPage(`<div class="whatever-linkedin-ships-next"><h2>Contact info</h2>${OVERLAY_ROWS}</div>`),
    );
    check(() => assert.equal(plain.status, "done"));
    check(() => assert.equal(plain.email, "apurvakhedikar24@gmail.com"));

    // 4. Rendered into a shadow root. document.querySelectorAll cannot see
    //    this at all; the invitation lane's reader has pierced shadow roots
    //    for exactly this reason and this one now does too.
    const shadowPage = await ctx.newPage();
    await shadowPage.setContent(overlayPage(""));
    await shadowPage.evaluate((markup) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      host.attachShadow({ mode: "open" }).innerHTML = markup;
    }, DIALOG(OVERLAY_ROWS));
    const shadow = (await shadowPage.evaluate(readContactInfo, { confirmedFirstDegree: true })) as Result;
    await shadowPage.close();
    check(() => assert.equal(shadow.status, "done"));
    check(() => assert.equal(shadow.email, "apurvakhedikar24@gmail.com"));

    // 5. The shell renders before its rows. "Not yet" must be `waiting`, so the
    //    caller looks again — reporting it as failed is what produced
    //    "Contact info overlay did not open" against a visibly open overlay.
    const lazy = await ctx.newPage();
    await lazy.setContent(overlayPage(DIALOG("")));
    const early = (await lazy.evaluate(readContactInfo, { confirmedFirstDegree: true })) as Result;
    check(() => assert.equal(early.status, "waiting"));
    check(() => assert.equal(early.state, "OPEN_LOADING"));
    await lazy.evaluate((rows) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) dialog.insertAdjacentHTML("beforeend", rows);
    }, OVERLAY_ROWS);
    const settled = (await lazy.evaluate(readContactInfo, { confirmedFirstDegree: true })) as Result;
    await lazy.close();
    check(() => assert.equal(settled.status, "done"));
    check(() => assert.equal(settled.email, "apurvakhedikar24@gmail.com"));

    // 6. Open, readable, and genuinely holding no email or phone. That is a
    //    finished lookup with nothing to show, not a failure, and it must not
    //    be retried or reported as one.
    const empty = await readOverlay(
      overlayPage(DIALOG(`<section><h3><span>Connected since</span></h3><span>Sep 11, 2026</span></section>`)),
    );
    check(() => assert.equal(empty.status, "done"));
    check(() => assert.equal(empty.email, null));
    check(() => assert.equal(empty.result, "no email or phone shown"));

    // 7. Nothing open: `waiting`, and the caller's budget decides when to stop.
    const closed = await readOverlay(overlayPage(""));
    check(() => assert.equal(closed.status, "waiting"));
    check(() => assert.equal(closed.state, "CLOSED"));

    // 8. Giving up collects the page's own markup, which is what makes the next
    //    selector fix something other than a guess. Asked for separately so the
    //    eight looks a lookup takes stay cheap: the diagnostic walk visits
    //    every element on the page hunting for shadow roots.
    const diagnosed = await readOverlay2(overlayPage(DIALOG(OVERLAY_ROWS)), { confirmedFirstDegree: true, diagnoseOnly: true });
    check(() => assert.equal(diagnosed.status, "diagnostics"));
    check(() => assert.equal(diagnosed.diagnostics?.overlayState, "OPEN_READABLE"));
    check(() => assert.match(String(diagnosed.diagnostics?.html), /Contact info/));
    check(() => assert.equal(diagnosed.diagnostics?.visibleDialogCount, 1));
    // A `waiting` look carries counts, not a page walk.
    check(() => assert.equal(closed.diagnostics, undefined));

    // 9. A challenge stops the lookup rather than retrying into it.
    const challenged = await readOverlay(overlayPage(`<iframe src="https://www.linkedin.com/captcha/v2"></iframe>`));
    check(() => assert.equal(challenged.status, "failed"));
    check(() => assert.equal(challenged.fatal, true));
    check(() => assert.equal(challenged.reasonCode, "security_challenge"));

    // 10. The concatenation trap: an ancestor's text is every row run together,
    //     so a regex over it matches "Emailapurva@example.com" as an address.
    //     The value must come from the row, never from the joined-up text.
    const concatenated = await readOverlay(
      overlayPage(`<div role="dialog"><h2>Contact info</h2><div><div><span>Email</span><span>apurva@example.com</span></div></div></div>`),
    );
    check(() => assert.equal(concatenated.status, "done"));
    check(() => assert.equal(concatenated.email, "apurva@example.com"));

    console.log(`LinkedIn enrichment selector fixtures: ${checks}/${checks} passed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
