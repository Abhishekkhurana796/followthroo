/**
 * Verification: the desktop app acts on the person you chose, and nobody else.
 *
 *   npx tsx scripts/verify-linkedin-target.ts
 *
 * A real LinkedIn profile is not one Connect button. "People also viewed" and
 * "More profiles for you" each render a card per person, every one with its own
 * working Connect. The reported symptom — "it opens the profile but randomly
 * clicks on the site without knowing where to click" — was that: a
 * document-wide search for /^Connect/ finds a stranger from the rail as readily
 * as the person you meant. An invitation cannot be quietly recalled, so sending
 * one to the wrong person is worse than sending nothing at all.
 *
 * This drives the real fillLinkedInAction out of desktop/page-actions.js — the
 * same module the desktop app hands to Playwright at runtime, not a copy — so a
 * selector that passes here is the selector that ships.
 *
 * No network, no database, no LinkedIn account: every request is fulfilled from
 * the local fixture, which is also what lets us claim to be at a given /in/ URL
 * and exercise the identity guard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { fillLinkedInAction } from "../desktop/page-actions";

const ROOT = join(__dirname, "..");
const FIXTURE = join(ROOT, "scripts", "linkedin-fixtures", "profile-with-sidebar.html");

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) {
    pass++;
    console.log("  ok  ", m);
  } else {
    fail++;
    console.log("  FAIL", m);
  }
};

type Outcome = { status: string; result?: string; kind?: string; fatal?: string };

async function main() {
  const html = readFileSync(FIXTURE, "utf8");
  const browser = await chromium.launch();

  try {
    const ctx = await browser.newContext();
    // Serve the fixture for every URL, so the page believes it is on linkedin.com
    // at whatever /in/ slug we navigate to.
    await ctx.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
    );

    const run = async (url: string, action: Record<string, unknown>, withBanner = false) => {
      const page = await ctx.newPage();
      await page.goto(url);
      if (withBanner) {
        // The do-not-touch bar the desktop run pins to every page. It sits
        // outside <main> with pointer-events:none, but "outside main" is a
        // claim worth testing rather than trusting.
        await page.evaluate(() => {
          const bar = document.createElement("div");
          bar.setAttribute("data-followthroo-overlay", "1");
          bar.innerHTML = '<button aria-label="Connect">Connect</button>';
          document.body.prepend(bar);
        });
      }
      const out = (await page.evaluate(fillLinkedInAction, action)) as Outcome;
      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      const sentIn = await page.evaluate(() => (window as never as { __sentIn?: string }).__sentIn ?? null);
      // Read from what the fixture recorded at send time: the dialog and the
      // message box are both cleared by then.
      const note = await page.evaluate(() => (window as never as { __note?: string }).__note ?? null);
      const sentText = await page.evaluate(() => (window as never as { __sentText?: string }).__sentText ?? null);
      await page.close();
      return { ...out, invited, sentIn, note, sentText };
    };

    const RIGHT = "https://www.linkedin.com/in/anirudh-bisht/";

    // 1. An invite, with the rail's Connect buttons sitting earlier in the document.
    {
      const r = await run(RIGHT, {
        type: "invite",
        linkedinUrl: RIGHT,
        note: "Hi Anirudh — saw your work at Welco.",
        autoSend: true,
      });
      ok(r.invited === "right", `invites the profile's owner, not the sidebar (invited: ${r.invited})`);
      ok(r.status === "sent", `reports sent once the dialog closed (status: ${r.status} — ${r.result})`);
      ok(r.note === "Hi Anirudh — saw your work at Welco.", "the note reaches the invite dialog intact");
    }

    // 2. A message, with a stale conversation window open for somebody else.
    {
      const r = await run(RIGHT, {
        type: "message",
        linkedinUrl: RIGHT,
        note: "Thanks for connecting.",
        autoSend: true,
      });
      ok(r.sentIn === "right", `sends in the window it opened, not the stale one (sent in: ${r.sentIn})`);
      ok(r.sentText === "Thanks for connecting.", `the body goes to that window intact (got: ${r.sentText})`);
      ok(r.status === "sent", `reports sent once the box cleared (status: ${r.status} — ${r.result})`);
    }

    // 3. A redirect: a renamed vanity URL lands us on somebody else's profile.
    //    Acting on whoever is on screen is how the wrong person gets invited.
    {
      const r = await run("https://www.linkedin.com/in/someone-else/", {
        type: "invite",
        linkedinUrl: RIGHT,
        note: "Hi Anirudh —",
        autoSend: true,
      });
      ok(r.invited === null, "nobody is invited after landing on a different profile");
      ok(r.status === "failed", `the mismatch is reported, not swallowed (status: ${r.status})`);
      ok(/not acting on the wrong profile/.test(r.result || ""), `the reason says why: ${r.result}`);
    }

    // 4. The profile card has no Connect of its own. The only Connect buttons
    //    left belong to strangers in "More profiles for you" — inside <main>, so
    //    excluding the sidebar does not save us; only anchoring to the profile's
    //    own card does. Doing nothing here is the correct outcome.
    {
      const r = await run(RIGHT + "?noconnect", {
        type: "invite",
        linkedinUrl: RIGHT,
        note: "Hi Anirudh —",
        autoSend: true,
      });
      ok(r.invited === null, `no stranger is invited when the profile itself offers no Connect (invited: ${r.invited})`);
      // Falling back to a message is the existing, intended behaviour for someone
      // you cannot invite (usually because you are already connected). What must
      // never happen is that the fallback lands on one of the strangers.
      ok(r.sentIn === "right", `it falls back to messaging that same person (sent in: ${r.sentIn})`);
    }

    // 5. Auto-send off still means a human clicks Send — but on the right person.
    {
      const r = await run(RIGHT, { type: "invite", linkedinUrl: RIGHT, note: "Hi Anirudh —", autoSend: false });
      ok(r.invited === "right", `drafting also opens the right person's dialog (invited: ${r.invited})`);
      ok(r.status === "drafted", `nothing is sent without the switch (status: ${r.status})`);
    }

    // 6. LinkedIn has run out of invitations for the week. Every remaining
    //    action would hit the same wall, so this must come back marked fatal —
    //    otherwise the run keeps knocking on a door that is being held shut.
    {
      const r = await run(RIGHT + "?limitwall", {
        type: "invite",
        linkedinUrl: RIGHT,
        note: "Hi Anirudh —",
        autoSend: true,
      });
      ok(r.status === "failed", `a limit wall is not a send (status: ${r.status})`);
      ok(r.fatal === "limit", `it is marked fatal so the run stops (fatal: ${r.fatal})`);
      ok(/weekly invitation limit/i.test(r.result || ""), `the reason names the limit: ${r.result}`);
    }

    // 7. Our own do-not-touch banner carries the word "Connect". It is pinned to
    //    every page of a run, so if the selectors could reach it, every single
    //    invitation would click our own overlay instead of LinkedIn's button.
    {
      const r = await run(RIGHT, { type: "invite", linkedinUrl: RIGHT, note: "Hi Anirudh —", autoSend: true }, true);
      ok(r.invited === "right", `the overlay is never mistaken for the profile's button (invited: ${r.invited})`);
      ok(r.status === "sent", `the invitation still goes through with the banner up (status: ${r.status})`);
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
