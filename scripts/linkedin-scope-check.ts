/**
 * Ask LinkedIn which scopes this app actually holds.
 *
 *   npx tsx --env-file=.env.local scripts/linkedin-scope-check.ts
 *   npx tsx --env-file=.env.local scripts/linkedin-scope-check.ts https://app.followthroo.com
 *
 * Why this exists: LinkedIn fails the WHOLE consent with `invalid_scope_error`
 * when an app requests one permission it has not been granted — it does not drop
 * the offending scope and carry on. A single missing Product in the Developer
 * Portal therefore breaks connecting entirely, and the error names no scope,
 * which makes it close to undiagnosable by inspection.
 *
 * Nothing is authorized and no token is issued — the redirect is never followed.
 * `client_id` is public by design (it travels in every consent URL); the client
 * secret is neither read nor sent.
 *
 * ---- Reading LinkedIn's answer ----
 *
 * There is no clean API for this, and the obvious approaches both give false
 * passes. LinkedIn always answers HTTP 200 with an HTML interstitial ("Bummer,
 * something went wrong"), so status codes tell you nothing; and its CSS class
 * names include `error__wrapper`, `error__message` and so on, so grepping the
 * markup for "error" matches every response including successful ones.
 *
 * What is reliable is the redirect URL printed inside that interstitial, which
 * carries the real `error=` code. That is what this parses.
 *
 * Note the default redirect URI is the PRODUCTION one, not env.appUrl. Probing
 * with an unregistered URI (localhost, say) makes LinkedIn reject on the URI
 * before it ever evaluates scopes, and every scope then looks fine.
 */

// Marks this file as a module. Without it TypeScript treats a script with no
// imports as global scope, and `main` collides with every other script here.
export {};

const DEFAULT_REDIRECT = "https://app.followthroo.com/api/linkedin/oauth/callback";

const CANDIDATES = [
  process.env.LINKEDIN_SCOPES?.trim() || "openid profile email w_member_social",
  "openid profile email",
  "openid profile",
  "profile",
  "email",
  "w_member_social",
];

type Result =
  | { kind: "granted" }
  | { kind: "rejected" }
  | { kind: "incomplete" } // the scope exists, but LinkedIn wants companions
  | { kind: "redirect_mismatch" }
  | { kind: "other"; code: string; description: string };

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function probe(scope: string, redirectUri: string): Promise<Result> {
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.LINKEDIN_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", "scope-check");
  u.searchParams.set("scope", scope);

  const res = await fetch(u, { redirect: "manual" });
  const haystack = `${res.headers.get("location") ?? ""} ${visibleText(await res.text())}`;

  if (/redirect_uri does not match/i.test(haystack)) return { kind: "redirect_mismatch" };

  const code = /[?&]error=([^&\s]+)/.exec(haystack)?.[1];
  if (!code) return { kind: "granted" };

  const description = decodeURIComponent(
    (/[?&]error_description=([^&\s]+)/.exec(haystack)?.[1] ?? "").replace(/\+/g, " "),
  );

  if (code === "invalid_scope_error") return { kind: "rejected" };
  // "Include valid openId scopes like profile, email." — the scope itself is
  // granted; LinkedIn simply refuses `openid` on its own.
  if (code === "openid_insufficient_scope_error") return { kind: "incomplete" };
  return { kind: "other", code, description };
}

async function main() {
  if (!process.env.LINKEDIN_CLIENT_ID) {
    console.error("LINKEDIN_CLIENT_ID is not set. Run with --env-file=.env.local");
    process.exit(1);
  }

  const redirectUri = process.argv[2]
    ? `${process.argv[2].replace(/\/$/, "")}/api/linkedin/oauth/callback`
    : DEFAULT_REDIRECT;

  console.log(`\nProbing LinkedIn scopes\n  redirect_uri: ${redirectUri}\n`);

  const rejected: string[] = [];

  for (const scope of CANDIDATES) {
    const r = await probe(scope, redirectUri);

    if (r.kind === "redirect_mismatch") {
      console.log(
        `  This redirect URI is not registered on the app, so scopes cannot be tested.\n` +
          `  Register it in the Developer Portal (Auth -> Authorized redirect URLs), or pass\n` +
          `  a base URL that is: ...scripts/linkedin-scope-check.ts https://app.followthroo.com\n`,
      );
      process.exit(1);
    }

    const label =
      r.kind === "granted"
        ? "granted "
        : r.kind === "rejected"
          ? "REJECTED"
          : r.kind === "incomplete"
            ? "granted*"
            : `ERR     `;
    console.log(`  ${label}  ${scope}${r.kind === "other" ? `  (${r.code}: ${r.description})` : ""}`);

    if (r.kind === "rejected" && !scope.includes(" ")) rejected.push(scope);
    // LinkedIn rate-limits the consent endpoint; pace the probes.
    await new Promise((res) => setTimeout(res, 400));
  }

  console.log("\n  * granted, but LinkedIn will not accept it on its own.\n");

  if (rejected.length) {
    console.log("Missing scopes map to Products in the LinkedIn Developer Portal:\n");
    if (rejected.some((s) => ["profile", "email"].includes(s))) {
      console.log('  profile / email    ->  add "Sign In with LinkedIn using OpenID Connect"');
    }
    if (rejected.includes("w_member_social")) {
      console.log('  w_member_social    ->  add "Share on LinkedIn"');
    }
    console.log(
      "\nBoth are self-serve, but the app must first be linked to a LinkedIn Page you can\n" +
        "verify — that verification is usually the real blocker.\n" +
        "https://www.linkedin.com/developers/apps -> your app -> Products\n",
    );
    process.exit(1);
  }

  console.log("Every probed scope is granted. Connecting should work.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
