/** Profile-degree fixtures for the desktop enrichment safety gate. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readContactInfo } from "../desktop/page-actions";
import { observe } from "../desktop/pilot-page";

const pageFor = (degreeMarkup: string) => `<!doctype html><main>
  <div data-view-name="profile-top-card"><div><h1>Asha Rao</h1><a href="/in/asha-rao/overlay/contact-info/">Contact info</a>${degreeMarkup}</div></div>
</main>`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  try {
    const run = async (html: string) => {
      const page = await ctx.newPage();
      await page.setContent(html);
      const result = await page.evaluate(readContactInfo, { eligibilityOnly: true });
      await page.close();
      return result;
    };

    const modernFirst = await run(pageFor('<span class="pv-member-badge" aria-label="1st degree connection">1st</span>'));
    assert.equal(modernFirst.status, "eligible");
    assert.equal(modernFirst.degree, "1st");
    assert.match(String(modernFirst.evidence), /profile (header )?badge/i);

    // Current LinkedIn profile headers use a plain text degree beside pronouns,
    // not necessarily the old .pv-member-badge class.
    const headerFirst = await run(`<!doctype html><main>
      <div data-view-name="profile-top-card"><div><h1>Apurva Gurav</h1><span>She/Her</span><span>1st</span><a href="/in/apurva-gurav/overlay/contact-info/">Contact info</a></div></div>
      <aside><span>1st</span></aside>
    </main>`);
    assert.equal(headerFirst.status, "eligible");
    assert.equal(headerFirst.degree, "1st");
    assert.match(String(headerFirst.evidence), /profile header badge/i);

    // Enrichment begins with the same observer and persistent Playwright flow
    // as invitation sending, so it must recognise this header too.
    const observedPage = await ctx.newPage();
    await observedPage.setContent(`<!doctype html><main>
      <div data-view-name="profile-top-card"><div><h1>Apurva Gurav</h1><span>She/Her</span><span>1st</span><button>Message</button><button>More</button></div></div>
    </main>`);
    const observed = await observedPage.evaluate(observe);
    await observedPage.close();
    assert.equal(observed.connectionDegree.degree, "1st");
    assert.match(String(observed.connectionDegree.evidence), /profile header badge/i);

    // The current Contact info surface is an ordinary accessible dialog, not
    // always LinkedIn's old .pv-contact-info class. The page reader must see
    // what a successful Playwright click has visibly opened.
    const overlay = await ctx.newPage();
    await overlay.setContent(`<!doctype html><main>
      <div data-view-name="profile-top-card"><h1>Apurva Gurav</h1><span>1st</span><a href="/in/apurva-gurav/overlay/contact-info/">Contact info</a></div>
      <div role="dialog" aria-modal="true"><h2>Contact info</h2><a href="mailto:apurva@example.com">apurva@example.com</a><div class="ci-phone"><span>+91 98765 43210</span></div></div>
    </main>`);
    const openedOverlay = await overlay.evaluate(readContactInfo, { confirmedFirstDegree: true, alreadyOpen: true });
    await overlay.close();
    assert.equal(openedOverlay.status, "done");
    assert.equal(openedOverlay.email, "apurva@example.com");
    assert.equal(openedOverlay.phone, "+91 98765 43210");

    const removeConnection = await run(pageFor('<button aria-label="Remove Connection">Remove Connection</button>'));
    assert.equal(removeConnection.status, "eligible");
    assert.equal(removeConnection.degree, "1st");
    assert.match(String(removeConnection.evidence), /Remove Connection/);

    const second = await run(pageFor('<span class="distance-badge">2nd</span>'));
    assert.equal(second.status, "skipped");
    assert.equal(second.degree, "2nd");
    assert.equal((second as { reasonCode?: string }).reasonCode, "degree_not_first");

    const stale = await run(pageFor('<div class="old-degree-widget">Connected?</div>'));
    assert.equal(stale.status, "skipped");
    assert.equal(stale.degree, "unknown");
    assert.equal((stale as { reasonCode?: string }).reasonCode, "degree_unverified");
    console.log("LinkedIn enrichment selector fixtures: 20/20 passed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
