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
import { PilotObservationSchema, userPrompt } from "../lib/linkedin/pilot";

const ROOT = join(__dirname, "..");
const FIXTURE = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-more-dropdown.html"), "utf8");
/** The markup that defeated every structural selector: Connect as a bare span. */
const SPAN_FIXTURE = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-span-connect.html"), "utf8");
/** The shape of a live profile: deep nesting, no <section>, a duplicate sticky row. */
const DEEP_FIXTURE = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-deep-card.html"), "utf8");
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
        page.evaluate(act, { decision, expectedName, forbiddenSource: FORBIDDEN.source, goal: "invite", autoSend: true });

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

    console.log("\n1b. Follow is not Connect, and an unidentified profile is not a free pass");
    {
      // The variant that has a Connect on the card, so the fail-closed check
      // below has a real Connect to be refused on.
      const page = await openPage(RIGHT + "?cardconnect");
      const expectedName = (await page.evaluate(observe)).personName;
      const run = (decision: Decision, name = expectedName) =>
        page.evaluate(act, { decision, expectedName: name, forbiddenSource: FORBIDDEN.source, goal: "invite", autoSend: true });

      // What actually happened on a real profile: the model reported "Connect
      // button is available directly on the profile" and clicked
      // "Follow <name>". It followed her on her real account. Nothing stopped
      // it — Follow is not destructive, and the name check was inert because
      // personName had come back empty.
      await page.evaluate(() => {
        const b = document.createElement("button");
        b.setAttribute("aria-label", "Follow Anirudh Bisht");
        b.addEventListener("click", () => {
          (window as never as { __followed?: boolean }).__followed = true;
        });
        document.querySelector("main section")?.appendChild(b);
      });
      const followIdx = await indexOf(page, /^Follow Anirudh Bisht/i);
      const follow = await run({ action: "click", index: followIdx });
      ok(follow.ok === false, `Follow is refused for an invite (${follow.error ?? "ALLOWED"})`);
      const followed = await page.evaluate(() => (window as never as { __followed?: boolean }).__followed ?? false);
      ok(followed === false, `and nobody was followed (followed: ${followed})`);

      // The name check must fail closed rather than open.
      const connectIdx = await indexOf(page, /Invite Anirudh Bisht to connect/i);
      const unknown = await run({ action: "click", index: connectIdx }, "");
      ok(unknown.ok === false, `a named button is refused when the profile is unidentified (${unknown.error ?? "ALLOWED"})`);
      await page.close();
    }

    console.log("\n1c. an unlabelled <span> Connect is seen, and clicked by its words");
    {
      const sctx = await browser.newContext();
      await sctx.route("**/*", (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SPAN_FIXTURE }),
      );
      const openSpan = async (url: string) => {
        const p = await sctx.newPage();
        await p.goto(url);
        return p;
      };

      // The regression that matters. This element used to be absent from the
      // list entirely — no role, no aria-label, hashed classes — so every "there
      // is no Connect button" was a true statement about the data, on a page
      // that plainly had one.
      const page = await openSpan(RIGHT);
      const seen = await page.evaluate(observe);
      const found = seen.elements.filter((e) => /^Connect$/i.test(e.label));
      ok(found.length > 0, `the span Connect is in the element list at all (found ${found.length})`);
      ok(found.some((e) => e.inTopCard), "and the profile's own one is marked as in the action row");

      // Named by its visible words, which is how the model will name it after
      // reading the screenshot.
      const byLabel = await page.evaluate(act, {
        decision: { action: "click", label: "Connect" },
        expectedName: seen.personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: true,
      });
      ok(byLabel.ok === true, `clicking by label works (${byLabel.error ?? byLabel.did})`);
      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === "right", `and it reached the profile owner, not a stranger (invited: ${invited})`);
      await page.close();

      // Two identical "Connect" spans, neither in the action row, neither
      // carrying a name. Text cannot tell them apart, and the name check has
      // nothing to read, so nothing may be clicked.
      const amb = await openSpan(RIGHT + "?ambiguous");
      const ambSeen = await amb.evaluate(observe);
      const ambRes = await amb.evaluate(act, {
        decision: { action: "click", label: "Connect" },
        expectedName: ambSeen.personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: true,
      });
      ok(ambRes.ok === false, `ambiguous text is refused, not guessed (${ambRes.error ?? "ALLOWED"})`);
      const ambInvited = await amb.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(ambInvited === null, `and nobody was invited (invited: ${ambInvited})`);
      await amb.close();
      await sctx.close();
    }

    console.log("\n1c2. the profile's own Connect is attributed with no help from the DOM");
    {
      const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await sctx.route("**/*", (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SPAN_FIXTURE }),
      );
      // Both containment signals defeated, as they are on the live site: the
      // action row is not inside a container that also holds the <h1>, and its
      // nearest heading is not the person's name. Every real run was in exactly
      // this position — inTopCard false for all 286 elements — so the two
      // Connects looked equally anonymous and the run refused three times and
      // gave up on a page whose Connect was plainly visible.
      const page = await sctx.newPage();
      await page.goto(RIGHT + "?nostructure");
      await page.waitForTimeout(400);

      const seen = await page.evaluate(observe);
      const connects = seen.elements.filter((e) => /^Connect$/i.test(e.label));
      ok(connects.length >= 2, `several controls read "Connect" (${connects.length})`);
      ok(
        connects.filter((c) => c.inTopCard).length === 1,
        `exactly one is attributed to this profile (${connects.filter((c) => c.inTopCard).length})`,
      );

      const res = await page.evaluate(act, {
        decision: { action: "click", label: "Connect" },
        expectedName: seen.personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: true,
      });
      ok(res.ok === true, `so it can be clicked rather than refused (${res.error ?? res.did})`);
      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === "right", `and it is the profile owner's (invited: ${invited})`);
      await page.close();
      await sctx.close();
    }

    console.log("\n1d. a test run cannot send, whatever the model decides");
    {
      const sctx = await browser.newContext();
      await sctx.route("**/*", (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SPAN_FIXTURE }),
      );
      const page = await sctx.newPage();
      await page.goto(RIGHT);
      const seen = await page.evaluate(observe);

      // Open the dialog so a Send control exists to be refused.
      await page.evaluate(act, {
        decision: { action: "click", label: "Connect" },
        expectedName: seen.personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: false,
      });
      await page.waitForTimeout(300);

      // "Allowed to actually send: no" was only a line in the prompt, which the
      // model is free to ignore — so a Test run could put a real invitation on
      // somebody's LinkedIn, and never record it, because a dry run reports
      // nothing to the server. Test and Start were doing the same thing.
      for (const label of ["Send now", "Send without a note"]) {
        const res = await page.evaluate(act, {
          decision: { action: "click", label },
          expectedName: seen.personName,
          forbiddenSource: FORBIDDEN.source,
          goal: "invite",
          autoSend: false,
        });
        ok(res.ok === false, `"${label}" is refused during a test run (${res.error ?? "ALLOWED"})`);
      }
      const sentPlain = await page.evaluate(
        () => (window as never as { __sentWithoutNote?: boolean }).__sentWithoutNote ?? false,
      );
      const note = await page.evaluate(() => (window as never as { __note?: string }).__note ?? null);
      ok(sentPlain === false && note === null, `and nothing was actually sent (plain: ${sentPlain}, note: ${note})`);
      await page.close();
      await sctx.close();
    }

    console.log("\n1e. on a page shaped like the real thing, the profile's own Connect is found");
    {
      const dctx = await browser.newContext();
      await dctx.route("**/*", (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: DEEP_FIXTURE }),
      );

      // The regression this suite missed for four releases. Every earlier
      // fixture kept the <h1> and the buttons in one <section> a level apart, so
      // `inTopCard` was true here and false on every real profile — and a marker
      // that is never true means act() cannot tell the profile's own Connect
      // from a stranger's, refuses both, and three refusals end the action. The
      // logs show no invitation ever sent, on any run, while this suite passed.
      const page = await dctx.newPage();
      await page.goto(RIGHT);
      const seen = await page.evaluate(observe);

      const connects = seen.elements.filter((e) => /^Connect$/i.test(e.label));
      const own = connects.filter((e) => e.inTopCard);
      ok(connects.length >= 4, `all four Connect controls are seen (found ${connects.length})`);
      ok(own.length === 1, `exactly one is attributed to this profile (marked ${own.length})`);
      ok(
        (own[0]?.section ?? "").toLowerCase() === "anirudh bisht",
        `and it is the one under the owner's own heading (under: ${own[0]?.section ?? "none"})`,
      );

      // The sticky duplicate action row sits under no heading at all, so nothing
      // can attribute it. Unmarked is correct: the real card's Connect is marked
      // and clickable whatever the page is scrolled to.
      const sticky = connects.find((e) => e.section === null && !e.inAside);
      ok(!!sticky && !sticky.inTopCard, "the unattributable sticky duplicate stays unmarked");

      // False on every real page today, which is why each action also burned the
      // full twelve-second hydration wait before doing anything at all.
      ok(seen.profileReady === true, `the profile reads as ready (was: ${seen.profileReady})`);

      const byLabel = await page.evaluate(act, {
        decision: { action: "click", label: "Connect" },
        expectedName: seen.personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: true,
      });
      ok(byLabel.ok === true, `clicking by label is allowed (${byLabel.error ?? byLabel.did})`);
      const invited = await page.evaluate(() => (window as never as { __invited?: string }).__invited ?? null);
      ok(invited === "right", `and it reached the profile owner (invited: ${invited})`);
      await page.close();

      // "Others named Anirudh Bisht" carries the owner's own name as its
      // heading, so heading text alone would hand us a stranger. A coordinate
      // answer is the path that never went through the text resolver, and so
      // never had this checked — and the span carries no name for the name
      // check to read either.
      const strangers = await dctx.newPage();
      await strangers.goto(RIGHT);
      const box = await strangers.locator('[data-who="wrong-named"]').boundingBox();
      const byPoint = await strangers.evaluate(act, {
        decision: { action: "click", x: Math.round((box?.x ?? 0) + 4), y: Math.round((box?.y ?? 0) + 4) },
        expectedName: (await strangers.evaluate(observe)).personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: true,
      });
      ok(byPoint.ok === false, `a point on "Others named" is refused (${byPoint.error ?? "ALLOWED"})`);
      ok(
        (await strangers.evaluate(() => (window as never as { __invited?: string }).__invited ?? null)) === null,
        "and that stranger was not invited",
      );
      await strangers.close();

      // Nothing attributable to anybody. Refusing is still the only safe answer,
      // but the refusal now says what to try instead — repeating one dead-end
      // suggestion until the third refusal is what ended the action before.
      const amb = await dctx.newPage();
      await amb.goto(RIGHT + "?ambiguous");
      const ambSeen = await amb.evaluate(observe);
      const ambRes = await amb.evaluate(act, {
        decision: { action: "click", label: "Connect" },
        expectedName: ambSeen.personName,
        forbiddenSource: FORBIDDEN.source,
        goal: "invite",
        autoSend: true,
      });
      ok(ambRes.ok === false, `genuinely ambiguous text is still refused (${ambRes.error ?? "ALLOWED"})`);
      ok(/elements \d+, \d+/.test(ambRes.error ?? ""), `and the refusal names the candidates: ${ambRes.error}`);
      ok(
        (await amb.evaluate(() => (window as never as { __invited?: string }).__invited ?? null)) === null,
        "and nobody was invited",
      );
      await amb.close();
      await dctx.close();
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
        goal: "invite",
        autoSend: true,
      });
      await page.waitForTimeout(400);

      for (const [pattern, name] of [[/Remove Connection/i, "Remove Connection"], [/Report/i, "Report"]] as const) {
        const idx = await indexOf(page, pattern);
        const res = await page.evaluate(act, {
          decision: { action: "click", index: idx },
          expectedName,
          forbiddenSource: FORBIDDEN.source,
          goal: "invite",
          autoSend: true,
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

    console.log("\n6. the markers survive the trip to the model");
    {
      // The other half of the same bug. The page computed `inTopCard`, and the
      // endpoint's schema — a separate copy of the type, in a different file —
      // did not declare it, so Zod stripped it along with `section` and `y`.
      // The prompt then spent three paragraphs telling the model to rely on a
      // marker it was never sent. Asserted on the rendered prompt rather than
      // the parsed object, because the prompt is where it has to show up.
      const wire = {
        goal: "invite" as const,
        personName: "Anirudh Bisht",
        note: null,
        autoSend: true,
        url: RIGHT,
        step: 0,
        history: [],
        elements: [
          { i: 0, tag: "span", label: "Connect", inTopCard: true, section: "Anirudh Bisht", y: 511 },
          { i: 1, tag: "span", label: "Connect", inAside: true, section: "People you may know", y: 2210 },
        ],
      };

      const parsed = PilotObservationSchema.safeParse(wire);
      ok(parsed.success, `a real observation validates (${parsed.success ? "ok" : parsed.error.issues[0]?.message})`);
      if (parsed.success) {
        ok(parsed.data.elements[0].inTopCard === true, "inTopCard survives validation");
        ok(parsed.data.elements[0].section === "Anirudh Bisht", "section survives validation");
        const prompt = userPrompt(parsed.data);
        ok(/IN-PROFILE-ACTION-ROW/.test(prompt), "the prompt marks the profile's own action row");
        ok(/\[under: Anirudh Bisht\]/.test(prompt), "and says what each control sits under");
        ok(/IN-SIDEBAR-DO-NOT-USE/.test(prompt), "and still marks the sidebar");
      }
    }

    console.log("\n7. profile enrichment is a one-click, read-only pilot");
    {
      const page = await openPage(RIGHT + "?cardconnect");
      await page.evaluate(() => {
        const safe = document.createElement("a");
        safe.textContent = "Contact info";
        safe.href = "/in/anirudh-bisht/overlay/contact-info/";
        safe.setAttribute("data-ft-idx", "900");
        safe.setAttribute("data-ft-top", "1");
        safe.addEventListener("click", (event) => { event.preventDefault(); (window as unknown as { __contactClicks: number }).__contactClicks = ((window as unknown as { __contactClicks?: number }).__contactClicks || 0) + 1; });
        document.body.appendChild(safe);

        const unsafe = document.createElement("a");
        unsafe.textContent = "Contact info";
        unsafe.href = "/in/wrong-person/overlay/contact-info/";
        unsafe.setAttribute("data-ft-idx", "901");
        document.body.appendChild(unsafe);
      });
      const run = (decision: Decision) => page.evaluate(act, { decision, expectedName: "anirudh bisht", forbiddenSource: FORBIDDEN.source, goal: "enrich", autoSend: false });

      const safe = await run({ action: "click", index: 900 });
      ok(safe.ok === true, `the owner's Contact info control is allowed (${safe.error ?? safe.did})`);
      const wrongKind = await run({ action: "click", label: "Connect" });
      ok(wrongKind.ok === false, `outreach is refused (${wrongKind.error})`);
      const wrongCard = await run({ action: "click", index: 901 });
      ok(wrongCard.ok === false && /not in this profile/i.test(wrongCard.error || ""), `another card is refused (${wrongCard.error})`);
      const point = await run({ action: "click", x: 10, y: 10 });
      ok(point.ok === false && /coordinate/i.test(point.error || ""), `coordinates are refused (${point.error})`);

      const parsed = PilotObservationSchema.safeParse({
        goal: "enrich", personName: "Anirudh Bisht", note: null, autoSend: false, useNote: false,
        url: RIGHT, step: 0, history: [], elements: [{ i: 900, tag: "a", label: "Contact info", inTopCard: true }],
      });
      ok(parsed.success && /Read-only lookup/.test(userPrompt(parsed.data)), "the enrichment wire contract and safety prompt validate");
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
