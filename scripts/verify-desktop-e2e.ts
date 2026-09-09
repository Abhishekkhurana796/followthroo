/**
 * End to end: does an invitation actually reach the queue?
 *
 *   npx tsx scripts/verify-desktop-e2e.ts
 *
 * Every other suite stubs something. This one stubs only LinkedIn: a fake
 * Followthroo hands out one action and records what comes back, but the
 * `/api/linkedin/assist` calls are forwarded to the real deployment, so the real
 * model reads the real prompt and decides for itself. The page it reads is the
 * markup that defeated seven rounds of fixes — Connect as an unlabelled <span>.
 *
 * What it proves, which nothing else does: the whole path holds together —
 * claim, observe, ask, veto, click, confirm, report "sent" — and the model, left
 * to itself, finds a button that no structural selector can see.
 *
 * Nothing is sent to LinkedIn. The page is a fixture; there is no session.
 *
 * Needs: a LinkedInAccount row for its pairing token, and a deployment with a
 * model configured.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { runBatch } from "../desktop/runner";

const ROOT = join(__dirname, "..");
const FIXTURE = readFileSync(join(ROOT, "scripts", "linkedin-fixtures", "profile-span-connect.html"), "utf8");
const UPSTREAM = process.env.FT_UPSTREAM || "https://app.followthroo.com";
const PROFILE = "https://www.linkedin.com/in/anirudh-bisht/";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) { pass++; console.log("  ok  ", m); }
  else { fail++; console.log("  FAIL", m); }
};

type Report = { actionId: string; status: string; result?: string };

/**
 * A Followthroo that owns the queue and forwards the thinking.
 *
 * The queue is local so nothing touches real data; assist is proxied so the
 * decisions are the ones production would make.
 */
function fakeApp(token: string) {
  const reports: Report[] = [];
  const decisions: unknown[] = [];
  let handedOut = 0;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/linkedin/queue" && req.method === "GET") {
      handedOut++;
      return send(200, {
        ok: true,
        data: {
          pacing: { minDelaySec: 0, maxDelaySec: 0 },
          actions:
            handedOut > 1
              ? []
              : [
                  {
                    id: "e2e-1",
                    type: "invite",
                    linkedinUrl: PROFILE,
                    note: "Hi Anirudh — saw your work at Welco.",
                    leadName: "Anirudh Bisht",
                    autoSend: true,
                  },
                ],
        },
      });
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (url.pathname === "/api/linkedin/queue" && req.method === "POST") {
        reports.push(JSON.parse(body || "{}"));
        return send(200, { ok: true, data: { ok: true } });
      }

      if (url.pathname === "/api/linkedin/assist") {
        try {
          const upstream = await fetch(`${UPSTREAM}/api/linkedin/assist`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body,
          });
          const json = await upstream.json().catch(() => ({}));
          if (json?.data?.decision) decisions.push(json.data.decision);
          return send(upstream.status, json);
        } catch (e) {
          return send(502, { ok: false, error: String((e as Error).message) });
        }
      }
      send(404, { ok: false, error: "not found" });
    });
  });

  return {
    reports,
    decisions,
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

/** A browser whose every request is the fixture, so LinkedIn is never touched. */
function fixtureLauncher(browser: Browser) {
  return async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE }),
    );
    return ctx;
  };
}

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.linkedInAccount.findFirst({ select: { extToken: true } });
  await prisma.$disconnect();
  if (!account) throw new Error("no LinkedInAccount to borrow a pairing token from");

  const app = fakeApp(account.extToken);
  const base = await app.listen();
  const browser = await chromium.launch();

  console.log(`\nreal model via ${UPSTREAM}, fixture page, local queue\n`);

  try {
    const summary = await runBatch({
      apiBase: base,
      token: account.extToken,
      userDataPath: "",
      limit: 1,
      launch: fixtureLauncher(browser),
      onEvent: ((e: { type: string; message?: string }) => {
        if (e.type === "status" && e.message) console.log(`    · ${e.message}`);
      }) as () => void,
    });

    console.log("\n  decisions the real model made:");
    for (const d of app.decisions) console.log(`    ${JSON.stringify(d)}`);
    console.log("");

    ok(app.decisions.length > 0, `the model was actually consulted (${app.decisions.length} decisions)`);
    ok(summary.sent === 1, `one invitation was sent (sent: ${summary.sent}, failed: ${summary.failed})`);

    const sent = app.reports.filter((r) => r.status === "sent");
    ok(sent.length === 1, `and reported to the queue as sent (${sent.length} sent reports)`);
    ok(sent[0]?.actionId === "e2e-1", `for the action it was given (${sent[0]?.actionId})`);

    if (!summary.sent) console.log(`\n  why it did not: ${summary.stoppedBecause}\n`);
  } finally {
    await browser.close();
    await app.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
