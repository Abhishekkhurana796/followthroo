/**
 * Verification: the model decides, but it does not get the last word.
 *
 *   npx tsx scripts/verify-linkedin-pilot.ts
 *
 * Handing click decisions to a model buys resilience to LinkedIn's markup and
 * costs determinism. The trade is only acceptable because a wrong answer is
 * caught before it reaches the page — so this suite does not test the model at
 * all. It scripts the decisions a bad model would return and asserts the client
 * refuses them.
 *
 * The four that must never get through, each irreversible on a real account:
 * inviting somebody from the "People also viewed" rail, clicking Remove
 * Connection, reporting a person, and acting on a button that names somebody
 * other than the profile owner.
 *
 * A fake assist endpoint stands in for the server, and the LinkedIn page is the
 * same fixture the selector suite uses. No model, no network, no account.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { observe, act, FORBIDDEN } from "../desktop/pilot-page";
import { pilotAction } from "../desktop/pilot";

const ROOT = join(__dirname, "..");
const FIXTURE = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-more-dropdown.html"), "utf8");
const RIGHT = "https://www.linkedin.com/in/anirudh-bisht/";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) { pass++; console.log("  ok  ", m); }
  else { fail++; console.log("  FAIL", m); }
};

type Decision = Record<string, unknown>;

/** An assist endpoint that returns whatever decisions the test scripts. */
function fakeAssist(script: (obs: Record<string, unknown>) => Decision) {
  const seen: Record<string, unknown>[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const obs = JSON.parse(body || "{}");
      seen.push(obs);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { decision: script(obs) } }));
    });
  });
  return {
    seen,
    listen: () =>
      new Promise<string>((r) => {
        server.listen(0, "127.0.0.1", () => {
          const a = server.address();
          r(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
        });
      }),
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Find the index the page gave an element, by its label. */
async function indexOf(page: Page, pattern: RegExp): Promise<number> {
  const seen = await page.evaluate(observe);
  const hit = seen.elements.find((e) => pattern.test(e.label));
  if (!hit) throw new Error(`no element matching ${pattern} — saw: ${seen.elements.map((e) => e.label).join(" | ")}`);
  return hit.i;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route("**/*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE }),
  );

  const openPage = async (url: string) => {
    const page = await ctx.newPage();
    await page.goto(url);
    return page;
  };

  try {
    // ---- The veto, exercised directly on the page ------------------------
    console.log("\n1. the client refuses what a wrong model would do");
    {
      const page = await openPage(RIGHT + "?cardconnect");
      const expectedName = (await page.evaluate(observe)).personName;
      const run = (decision: Decision) =>
        page.evaluate(act, { decision, expectedName, forbiddenSource: FORBIDDEN.source });

      // A stranger's Connect, from the "People also viewed" rail.
      const strangerIdx = await indexOf(page, /Wrong Person One/i);
      const stranger = await run({ action: "click", index: strangerIdx });
      ok(stranger.ok === false, `a sidebar Connect is refused (${stranger.error ?? "ALLOWED"})`);

      // A stranger inside <main>, in "More profiles for you" — excluding the
      // sidebar is not enough on its own; the name check is what catches this.
      const inMainIdx = await indexOf(page, /Wrong Person Three/i);
      const inMain = await run({ action: "click", index: inMainIdx });
      ok(inMain.ok === false, `a stranger inside main is refused by name (${inMain.error ?? "ALLOWED"})`);

      // The right person's own Connect still goes through.
      const rightIdx = await indexOf(page, /Invite Anirudh Bisht to connect/i);
      const right = await run({ action: "click", index: rightIdx });
      ok(right.ok === true, `the profile owner's own Connect is allowed (${right.error ?? right.did})`);

      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === "right", `and it clicked the right person (invited: ${invited})`);
      await page.close();
    }

    console.log("\n2. destructive actions are refused whatever the model says");
    {
      const page = await openPage(RIGHT + "?connected");
      const expectedName = (await page.evaluate(observe)).personName;
      // Open the overflow menu so Remove Connection and Report exist.
      const moreIdx = await indexOf(page, /More actions/i);
      await page.evaluate(act, {
        decision: { action: "click", index: moreIdx },
        expectedName,
        forbiddenSource: FORBIDDEN.source,
      });
      await page.waitForTimeout(400);

      for (const [pattern, name] of [[/Remove Connection/i, "Remove Connection"], [/Report/i, "Report"]] as const) {
        const idx = await indexOf(page, pattern);
        const res = await page.evaluate(act, {
          decision: { action: "click", index: idx },
          expectedName,
          forbiddenSource: FORBIDDEN.source,
        });
        ok(res.ok === false, `${name} is refused (${res.error ?? "ALLOWED"})`);
      }
      const clicked = await page.evaluate(() => (window as never as { __clickedInMenu?: string }).__clickedInMenu ?? null);
      ok(clicked === null, `nothing destructive was actually clicked (clicked: ${clicked})`);
      await page.close();
    }

    // ---- The loop, end to end, with a scripted model ---------------------
    console.log("\n3. a well-behaved model completes an invitation");
    {
      const app = fakeAssist((obs) => {
        const els = obs.elements as { i: number; label: string }[];
        const find = (re: RegExp) => els.find((e) => re.test(e.label));
        const done = (obs.history as string[]).join(" ");
        if (!/clicked "Invite/.test(done)) {
          const c = find(/Invite Anirudh Bisht to connect/i);
          if (c) return { action: "click", index: c.i, reason: "connect" };
        }
        if (!/clicked "Add a note"/.test(done)) {
          const n = find(/Add a note/i);
          if (n) return { action: "click", index: n.i, reason: "add note" };
        }
        if (!/typed/.test(done)) {
          const t = find(/custom-message|no label/i);
          if (t) return { action: "type", index: t.i, text: String(obs.note ?? ""), reason: "note" };
        }
        const s = find(/Send now/i);
        if (s && !/clicked "Send now"/.test(done)) return { action: "click", index: s.i, reason: "send" };
        return { action: "done", reason: "sent" };
      });
      const base = await app.listen();
      const page = await openPage(RIGHT + "?cardconnect");

      const outcome = await pilotAction({
        page,
        action: { type: "invite", linkedinUrl: RIGHT, note: "Hi Anirudh —", autoSend: true },
        apiBase: base,
        token: "test",
      });
      await app.close();

      ok(outcome.status === "sent", `reports sent (status: ${outcome.status} — ${outcome.result})`);
      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === "right", `the right person was invited (invited: ${invited})`);
      const note = await page.evaluate(() => (window as never as { __note?: string }).__note ?? null);
      ok(note === "Hi Anirudh —", `the note went with it (got: ${note})`);
      await page.close();
    }

    console.log("\n4. a model that keeps suggesting the sidebar is stopped");
    {
      const app = fakeAssist((obs) => {
        const els = obs.elements as { i: number; label: string }[];
        const stranger = els.find((e) => /Wrong Person/i.test(e.label));
        return stranger
          ? { action: "click", index: stranger.i, reason: "wrong on purpose" }
          : { action: "done", reason: "nothing left" };
      });
      const base = await app.listen();
      const page = await openPage(RIGHT + "?cardconnect");

      const outcome = await pilotAction({
        page,
        action: { type: "invite", linkedinUrl: RIGHT, note: "Hi", autoSend: true },
        apiBase: base,
        token: "test",
      });
      await app.close();

      ok(outcome.status === "failed", `the run fails rather than complying (status: ${outcome.status})`);
      ok(/refused/i.test(outcome.result || ""), `and says it refused: ${outcome.result}`);
      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === null, `nobody was invited (invited: ${invited})`);
      await page.close();
    }

    console.log("\n5. a claim of success is checked against the page");
    {
      // Says "done" immediately, having done nothing at all.
      const app = fakeAssist(() => ({ action: "done", reason: "lying" }));
      const base = await app.listen();
      const page = await openPage(RIGHT + "?cardconnect");

      const outcome = await pilotAction({
        page,
        action: { type: "invite", linkedinUrl: RIGHT, note: "Hi", autoSend: true },
        apiBase: base,
        token: "test",
      });
      await app.close();

      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === null, `nothing was sent (invited: ${invited})`);
      // The important half. Reporting this as "sent" would put a contact in the
      // CRM that never happened and let a sequence follow up on a conversation
      // that never started, so "done" has to be backed by an actual click.
      ok(outcome.status === "failed", `an unbacked claim of success is not recorded as sent (status: ${outcome.status})`);
      ok(/without ever clicking Connect/i.test(outcome.result || ""), `and says why: ${outcome.result}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
