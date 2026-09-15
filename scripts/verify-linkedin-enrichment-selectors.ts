/** Profile-degree fixtures for the desktop enrichment safety gate. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readContactInfo } from "../desktop/page-actions";

const pageFor = (degreeMarkup: string) => `<!doctype html><main>
  <section><div><h1>Asha Rao</h1><a href="/in/asha-rao/overlay/contact-info/">Contact info</a></div></section>
  <div data-view-name="profile-top-card">${degreeMarkup}</div>
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
    assert.match(String(modernFirst.evidence), /profile badge/i);

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
    console.log("LinkedIn enrichment degree fixtures: 12/12 passed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
