/**
 * Verification for the deterministic connection driver.
 *
 *   npx tsx scripts/verify-connect-flow.ts
 *
 * The driver (desktop/connect-flow.js) decides which element to click without a
 * model, so unlike verify-linkedin-pilot.ts this suite is about *targeting*:
 * given a page with several "Connect" controls, does it pick the profile's own
 * one, refuse when it cannot, and never substitute Follow — and does it only
 * report "sent" when the page actually confirmed the invitation.
 *
 * The nine cases below are the spec's CASE 1-9. No model, no network, no account
 * — fixtures are fulfilled locally and the driver runs against them headless.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { observe } from "../desktop/pilot-page";
import { sendConnectionRequest } from "../desktop/connect-flow";
import { CODES } from "../desktop/outcome-codes";

const ROOT = join(__dirname, "..");
const DRIVER = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-driver.html"), "utf8");
const DEEP = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-deep-card.html"), "utf8");
/** No <h1> at all, an unhyphenated slug, and three competing "More"s. */
const H2NAME = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-h2-name.html"), "utf8");
const RIGHT = "https://www.linkedin.com/in/anirudh-bisht/";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) { pass++; console.log("  ok  ", m); }
  else { fail++; console.log("  FAIL", m); }
};

type Win = Window & {
  __invited?: string | null;
  __followed?: boolean;
  __sent?: string | null;
  __note?: string | null;
};

async function main() {
  const browser: Browser = await chromium.launch();

  /** A context that serves one fixture for every request. */
  const ctxFor = async (body: string): Promise<BrowserContext> => {
    const ctx = await browser.newContext();
    await ctx.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }),
    );
    return ctx;
  };

  const run = (
    page: Page,
    over: Partial<{ type: string; linkedinUrl: string; note: string | null; autoSend: boolean }> = {},
    opts: Partial<{ useNote: boolean }> = {},
  ) =>
    sendConnectionRequest({
      page,
      action: {
        type: "invite",
        linkedinUrl: RIGHT,
        note: null,
        autoSend: true,
        ...over,
      },
      useNote: opts.useNote ?? true,
      // No fallback: a deterministic path that cannot resolve must return a code,
      // not quietly hand off, so the tests see the driver's own verdict.
      fallback: null,
    });

  try {
    console.log("\nCASE 1 — one Connect on the card is clicked and sent");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      await page.goto(RIGHT);
      const out = await run(page, { note: null });
      ok(out.status === "sent", `status sent (${out.status} / ${out.code} — ${out.result})`);
      const sent = await page.evaluate(() => (window as Win).__sent ?? null);
      const invited = await page.evaluate(() => (window as Win).__invited ?? null);
      ok(sent === "right", `the profile owner was sent (${sent})`);
      ok(invited === "right", `and it was the owner's Connect that opened it (${invited})`);
      await ctx.close();
    }

    console.log("\nCASE 1b — with a note: Add a note → type → Send");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      await page.goto(RIGHT);
      const out = await run(page, { note: "Hi Anirudh —" }, { useNote: true });
      ok(out.status === "sent", `status sent (${out.status} / ${out.code})`);
      ok(out.noteUsed === true, `the note was recorded as used (${out.noteUsed})`);
      const note = await page.evaluate(() => (window as Win).__note ?? null);
      ok(note === "Hi Anirudh —", `and the note went with it (${note})`);
      await ctx.close();
    }

    console.log("\nCASE 2 — two Connects, one attributed: the owner's is chosen");
    {
      const ctx = await ctxFor(DEEP);
      const page = await ctx.newPage();
      await page.goto(RIGHT);
      const out = await run(page, { note: null });
      ok(out.status === "sent", `status sent (${out.status} / ${out.code})`);
      const invited = await page.evaluate(() => (window as Win).__invited ?? null);
      ok(invited === "right", `the owner was invited, not a stranger (${invited})`);
      await ctx.close();
    }

    console.log("\nCASE 3 — two Connects, none attributed: refuse as ambiguous");
    {
      const ctx = await ctxFor(DEEP);
      const page = await ctx.newPage();
      await page.goto(RIGHT + "?ambiguous");
      const out = await run(page, { note: null });
      ok(out.status === "failed", `status failed (${out.status})`);
      ok(out.code === CODES.CONNECT_BUTTON_AMBIGUOUS, `code CONNECT_BUTTON_AMBIGUOUS (${out.code})`);
      const invited = await page.evaluate(() => (window as Win).__invited ?? null);
      ok(invited === null, `nobody was invited (${invited})`);
      await ctx.close();
    }

    console.log("\nCASE 4 — Follow only: never Follow, return CONNECT_BUTTON_NOT_FOUND");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      await page.goto(RIGHT + "?followonly");
      const out = await run(page, { note: null });
      ok(out.status === "failed", `status failed (${out.status})`);
      ok(out.code === CODES.CONNECT_BUTTON_NOT_FOUND, `code CONNECT_BUTTON_NOT_FOUND (${out.code})`);
      const followed = await page.evaluate(() => (window as Win).__followed ?? false);
      ok(followed === false, `Follow was never clicked (${followed})`);
      await ctx.close();
    }

    console.log("\nCASE 5 — Connect inside the profile's own More menu");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      await page.goto(RIGHT + "?more");
      const out = await run(page, { note: null });
      ok(out.status === "sent", `status sent (${out.status} / ${out.code} — ${out.result})`);
      const sent = await page.evaluate(() => (window as Win).__sent ?? null);
      const followed = await page.evaluate(() => (window as Win).__followed ?? false);
      ok(sent === "right", `the owner was sent from the menu (${sent})`);
      ok(followed === false, `and Follow in the menu was not clicked (${followed})`);
      await ctx.close();
    }

    console.log("\nCASE 6 — wrong profile: stop with TARGET_PROFILE_MISMATCH");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      // The page is somebody else; the action was for Anirudh.
      await page.goto("https://www.linkedin.com/in/someone-else/");
      const out = await run(page, { linkedinUrl: RIGHT, note: null });
      ok(out.status === "failed", `status failed (${out.status})`);
      ok(out.code === CODES.TARGET_PROFILE_MISMATCH, `code TARGET_PROFILE_MISMATCH (${out.code})`);
      const invited = await page.evaluate(() => (window as Win).__invited ?? null);
      ok(invited === null, `nothing was clicked (${invited})`);
      await ctx.close();
    }

    console.log("\nCASE 7 — dialog opens but Send is absent: SEND_BUTTON_NOT_FOUND");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      await page.goto(RIGHT + "?nosend");
      const out = await run(page, { note: null });
      ok(out.status === "failed", `status failed (${out.status})`);
      ok(out.code === CODES.SEND_BUTTON_NOT_FOUND, `code SEND_BUTTON_NOT_FOUND (${out.code})`);
      const sent = await page.evaluate(() => (window as Win).__sent ?? null);
      ok(sent === null, `nothing was sent (${sent})`);
      await ctx.close();
    }

    console.log("\nCASE 8 — Send clicked but no confirmation: INVITATION_SUBMISSION_UNCONFIRMED");
    {
      const ctx = await ctxFor(DRIVER);
      const page = await ctx.newPage();
      await page.goto(RIGHT + "?nopending");
      const out = await run(page, { note: null });
      ok(out.status === "failed", `status failed (${out.status})`);
      ok(
        out.code === CODES.INVITATION_SUBMISSION_UNCONFIRMED,
        `code INVITATION_SUBMISSION_UNCONFIRMED (${out.code})`,
      );
      // Send WAS clicked (the page recorded it) — but the driver did not trust it.
      const sent = await page.evaluate(() => (window as Win).__sent ?? null);
      ok(sent === "right", `the click happened but was not trusted as sent (${sent})`);
      await ctx.close();
    }

    console.log("\nCASE 9 — automatic sending off: fill and draft, send nothing");
    {
      const ctx = await ctxFor(DEEP);
      const page = await ctx.newPage();
      await page.goto(RIGHT);
      const out = await run(page, { note: null, autoSend: false });
      ok(out.status === "drafted", `status drafted (${out.status})`);
      const w = (await page.evaluate(() => window as unknown as { __sentWithoutNote?: boolean; __note?: string | null })) as {
        __sentWithoutNote?: boolean;
        __note?: string | null;
      };
      ok(!w.__sentWithoutNote && (w.__note ?? null) === null, `nothing was sent (plain: ${w.__sentWithoutNote}, note: ${w.__note})`);
      await ctx.close();
    }

    console.log("\nCASE 10 — no <h1>, unhyphenated slug, three \"More\" buttons");
    {
      // The real /in/liannemui failure: 0 of 38 elements could be attributed,
      // because personName fell back to the slug ("liannemui" vs a heading
      // reading "lianne mui") and topCard/nameBox both need an <h1> that the
      // page does not have. The driver delegated, and the model was handed three
      // identical "More"s and correctly refused all three.
      const ctx = await ctxFor(H2NAME);
      const page = await ctx.newPage();
      const url = "https://www.linkedin.com/in/liannemui/";
      await page.goto(url);

      const seen = await page.evaluate(observe);
      ok(seen.personName === "lianne mui", `the name is read from the <h2> (${seen.personName})`);
      ok(seen.profileReady === true, `the profile reads as ready (${seen.profileReady})`);

      const mores = seen.elements.filter((e) => /^more\b|more actions/i.test(e.label.trim()));
      const ownMores = mores.filter((e) => e.ownStrong);
      ok(mores.length >= 3, `all three "More" controls are seen (${mores.length})`);
      ok(ownMores.length === 1, `exactly one is attributed to this profile (${ownMores.length})`);

      const out = await sendConnectionRequest({
        page,
        action: { type: "invite", linkedinUrl: url, note: null, autoSend: true },
        useNote: true,
        fallback: null,
      });
      ok(out.status === "sent", `status sent (${out.status} / ${out.code} — ${out.result})`);

      const opened = await page.evaluate(() => (window as unknown as { __openedMore?: string }).__openedMore ?? null);
      ok(opened === "own", `it opened the profile's own More, not the sticky bar or About (${opened})`);
      const sent = await page.evaluate(() => (window as Win).__sent ?? null);
      const followed = await page.evaluate(() => (window as Win).__followed ?? false);
      ok(sent === "right", `the owner was sent from inside that menu (${sent})`);
      ok(followed === false, `and Follow was never clicked (${followed})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
