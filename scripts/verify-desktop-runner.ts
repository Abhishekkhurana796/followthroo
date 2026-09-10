/**
 * Verification: the desktop run stops when it should.
 *
 *   npx tsx scripts/verify-desktop-runner.ts
 *   FT_CASES=2,3,4,5,6 npx tsx scripts/verify-desktop-runner.ts   # skip the slow one
 *
 * verify-linkedin-target.ts covers one action in isolation — the right person,
 * the right button. This covers the loop around it, which is where the damage
 * scales: a batch that does not stop sends twenty wrong things instead of one.
 *
 * Six rules, each of which has a plausible way of quietly not holding:
 *
 *   - the daily ceiling holds even when the server offers more work
 *   - LinkedIn's own limit wall ends the batch immediately, not on the third try
 *   - three failures in a row end it
 *   - a test run reports nothing back, so it cannot touch the CRM or the quota
 *   - automatic sending switched off means the run refuses to start
 *   - the connections check reports only people on "Connected" cards, and never
 *     from a test run
 *
 * A fake Followthroo answers /api/linkedin/queue, and every LinkedIn URL is
 * fulfilled from the same fixture the targeting test uses. No network, no
 * database, no LinkedIn account.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { runBatch, MAX_PER_DAY } from "../desktop/runner";

const ROOT = join(__dirname, "..");
const FIXTURE = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-with-sidebar.html"), "utf8");

/**
 * A connections list with a suggestion on the same page. The two "Connected"
 * cards are real connections; "suggested-person" is not, and may well be
 * somebody with an invitation pending — reporting them would record an
 * acceptance that never happened.
 */
const CONNECTIONS_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body><main>
  <section>
    ${["kavya-rao", "dev-malhotra"]
      .map(
        (slug) => `
    <div class="card">
      <a href="/in/${slug}/"><img alt="" width="56" height="56"></a>
      <div><a href="/in/${slug}/"><p>${slug}</p></a><p>Connected on 9 September 2026</p></div>
      <button>Message</button>
    </div>`,
      )
      .join("")}
  </section>
  <section>
    <h2>People you may know</h2>
    <div class="card"><a href="/in/suggested-person/"><p>Suggested Person</p></a><button>Connect</button></div>
  </section>
</main></body></html>`;

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

type Reported = { actionId: string; status: string; result?: string };

/**
 * Which cases to run, e.g. `FT_CASES=2,3,4,5,6`. Case 1 drives twenty real
 * browser iterations to prove the daily cap and takes minutes on its own; being
 * able to run the quick ones alone keeps the others usable while iterating.
 * Unset runs everything.
 */
const ONLY = (process.env.FT_CASES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const wants = (n: number) => ONLY.length === 0 || ONLY.includes(String(n));

/**
 * A Followthroo that hands out as many actions as asked for.
 *
 * `profileSuffix` picks which fixture behaviour the profile shows — "" for a
 * normal invitable profile, "?limitwall" for LinkedIn's weekly-limit dialog,
 * "?noconnect&single" for a profile that offers no action at all.
 */
function fakeApp(opts: { profileSuffix?: string; autoSend?: boolean } = {}) {
  const reported: Reported[] = [];
  /** Profile URLs the run reported from the connections list. */
  const seen: string[] = [];
  let handedOut = 0;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/api/linkedin/queue" && req.method === "GET") {
      handedOut++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            // Zero pacing: the gap between actions is the runner's own
            // behaviour and is not what this file is testing. Leaving it at
            // 45-120s would make the suite take half an hour.
            pacing: { minDelaySec: 0, maxDelaySec: 0 },
            actions: [
              {
                id: `action-${handedOut}`,
                type: "invite",
                linkedinUrl: `https://www.linkedin.com/in/anirudh-bisht/${opts.profileSuffix ?? ""}`,
                note: "Hi Anirudh —",
                leadName: `Lead ${handedOut}`,
                autoSend: opts.autoSend !== false,
              },
            ],
          },
        }),
      );
      return;
    }

    if (url.pathname === "/api/linkedin/queue" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        reported.push(JSON.parse(body || "{}"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { ok: true } }));
      });
      return;
    }

    if (url.pathname === "/api/linkedin/connections/seen" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(...((JSON.parse(body || "{}").profileUrls as string[] | undefined) ?? []));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { matched: 1 } }));
      });
      return;
    }

    // No model on this deployment, which is the one case that still falls back
    // to the selector path. These cases test the loop — claim, pace, stop — not
    // the pilot, so the deterministic path is what they want.
    if (url.pathname === "/api/linkedin/assist") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "No model is configured on this deployment." }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  return {
    reported,
    seen,
    handedOut: () => handedOut,
    listen: () =>
      new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
        });
      }),
    close: () =>
      new Promise<void>((r) => {
        // Node's fetch keeps its sockets alive, and server.close() waits for
        // every open connection before calling back — so without this the
        // suite hangs after the first case with nothing printed, which reads
        // exactly like a runner that never terminates.
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** A browser context that answers every linkedin.com request from the fixture. */
function fixtureLauncher(browser: Browser) {
  return async () => {
    const ctx = await browser.newContext();
    await ctx.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE }),
    );
    return ctx;
  };
}

/** The same, except the connections list is served its own fixture. */
function connectionsLauncher(browser: Browser) {
  return async () => {
    const ctx = await browser.newContext();
    await ctx.route("**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: route.request().url().includes("/mynetwork/invite-connect/connections") ? CONNECTIONS_FIXTURE : FIXTURE,
      }),
    );
    return ctx;
  };
}

async function main() {
  const browser = await chromium.launch();
  const launch = fixtureLauncher(browser);

  try {
    if (wants(1)) {
      console.log("\n1. daily ceiling (20 actions, paced at zero — takes a few minutes)");
      // 1. The daily ceiling. The fake app never runs out of work, so the only
      //    thing that can stop this is the runner's own cap. Asked for 50.
      {
        const app = fakeApp();
        const base = await app.listen();
        const summary = await runBatch({
          apiBase: base,
          token: "test",
          userDataPath: "",
          limit: 50,
          launch,
        });
        await app.close();
        ok(
          summary.sent === MAX_PER_DAY,
          `stops at ${MAX_PER_DAY} even when asked for 50 and offered unlimited work (sent: ${summary.sent})`,
        );
        ok(
          app.reported.filter((r) => r.status === "sent").length === MAX_PER_DAY,
          `reports exactly ${MAX_PER_DAY} sends back to the server (reported: ${app.reported.filter((r) => r.status === "sent").length})`,
        );
        ok(/Daily limit reached/i.test(summary.stoppedBecause || ""), `and says why: ${summary.stoppedBecause}`);
      }
    }

    if (wants(2)) {
      console.log("\n2. LinkedIn's weekly limit wall");
      // 2. LinkedIn's weekly limit wall. Every remaining action would hit the
      //    same wall, so one is enough to end the batch — the failure counter
      //    must not get three tries at it.
      {
        const app = fakeApp({ profileSuffix: "?limitwall" });
        const base = await app.listen();
        const summary = await runBatch({ apiBase: base, token: "test", userDataPath: "", launch });
        await app.close();
        ok(summary.attempted === 1, `stops on the first limit wall, not the third (attempted: ${summary.attempted})`);
        ok(summary.sent === 0, "nothing is recorded as sent when LinkedIn refused");
        ok(/weekly invitation limit/i.test(summary.stoppedBecause || ""), `and says why: ${summary.stoppedBecause}`);
      }
    }

    if (wants(3)) {
      console.log("\n3. three failures in a row");
      // 3. Failures in a row. A profile offering neither Connect nor Message is
      //    "skipped", not "failed", so this uses the identity guard instead: the
      //    queue keeps handing out a URL the page will not match.
      {
        const app = fakeApp();
        const base = await app.listen();
        const summary = await runBatch({
          apiBase: base,
          token: "test",
          userDataPath: "",
          launch: async () => {
            const ctx = await browser.newContext();
            // Every navigation lands on a different person than the action names.
            await ctx.route("**/*", (route) =>
              route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: FIXTURE.replace("/in/anirudh-bisht", "/in/someone-else"),
              }),
            );
            await ctx.addInitScript(() => history.replaceState({}, "", "/in/someone-else/"));
            return ctx;
          },
        });
        await app.close();
        ok(summary.failed === 3, `gives up after 3 failures in a row (failed: ${summary.failed})`);
        ok(summary.sent === 0, "and sends nothing while doing so");
        ok(/failures in a row/i.test(summary.stoppedBecause || ""), `and says why: ${summary.stoppedBecause}`);
      }
    }

    if (wants(4)) {
      console.log("\n4. a test run reports nothing");
      // 4. A test run. The whole point is to watch it work without consequences,
      //    so nothing may reach the server — a "sent" row here would move a lead
      //    to contacted and let a sequence advance off a rehearsal.
      {
        const app = fakeApp();
        const base = await app.listen();
        const summary = await runBatch({
          apiBase: base,
          token: "test",
          userDataPath: "",
          limit: 3,
          dryRun: true,
          launch,
        });
        await app.close();
        ok(app.reported.length === 0, `a test run reports nothing back (reported: ${app.reported.length})`);
        ok(summary.sent === 0, `and records no sends (sent: ${summary.sent})`);
        // Exactly three, not "more than nothing". A test run sends nothing, so
        // a loop that counts sends against the limit never reaches it: this
        // asked for three, got three drafts, and went back for more forever.
        // The limit has to count attempts when nothing is being sent.
        ok(summary.attempted === 3, `stops after the 3 it was asked for, rather than looping (attempted: ${summary.attempted})`);
      }
    }

    if (wants(5)) {
      console.log("\n5. automatic sending switched off");
      // 5. Automatic sending switched off in the web app. The run must refuse
      //    rather than quietly fill boxes nobody will ever click Send on — that
      //    was the old extension's failure mode, and it looked identical to
      //    working.
      {
        const app = fakeApp({ autoSend: false });
        const base = await app.listen();
        const summary = await runBatch({ apiBase: base, token: "test", userDataPath: "", launch });
        await app.close();
        ok(summary.attempted === 0, `refuses to start with automatic sending off (attempted: ${summary.attempted})`);
        ok(/Automatic sending is off/i.test(summary.stoppedBecause || ""), `and points at the switch: ${summary.stoppedBecause}`);
      }
    }

    if (wants(6)) {
      console.log("\n6. accepted invitations, read from the connections list");
      // 6. The connections check. Once due, the run reads the list before it
      //    claims anything, and reports only the people on "Connected" cards.
      //    Automatic sending is off here so the run stops straight after — the
      //    check is what is under test, not the send.
      {
        const app = fakeApp({ autoSend: false });
        const base = await app.listen();
        let checked = 0;
        await runBatch({
          apiBase: base,
          token: "test",
          userDataPath: "",
          launch: connectionsLauncher(browser),
          connectionsCheckDue: () => true,
          onConnectionsChecked: () => {
            checked++;
          },
        });
        await app.close();
        const expected = ["https://www.linkedin.com/in/kavya-rao", "https://www.linkedin.com/in/dev-malhotra"];
        ok(JSON.stringify(app.seen) === JSON.stringify(expected), `reports the two connections (reported: ${JSON.stringify(app.seen)})`);
        ok(!app.seen.some((u) => u.includes("suggested-person")), "a suggestion on the same page is not counted as a connection");
        ok(checked === 1, `records that the check ran, so it is not repeated for hours (recorded: ${checked})`);
      }
      {
        // A test run leaves no trace, and that includes this report.
        const app = fakeApp();
        const base = await app.listen();
        let checked = 0;
        await runBatch({
          apiBase: base,
          token: "test",
          userDataPath: "",
          limit: 1,
          dryRun: true,
          launch: connectionsLauncher(browser),
          connectionsCheckDue: () => true,
          onConnectionsChecked: () => {
            checked++;
          },
        });
        await app.close();
        ok(app.seen.length === 0 && checked === 0, `a test run does not read or report connections (reported: ${app.seen.length})`);
      }
      {
        // Not due: the run goes straight to work, with no detour to the list.
        const app = fakeApp({ autoSend: false });
        const base = await app.listen();
        await runBatch({ apiBase: base, token: "test", userDataPath: "", launch: connectionsLauncher(browser) });
        await app.close();
        ok(app.seen.length === 0, "when the check is not due, nothing is read");
      }
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
