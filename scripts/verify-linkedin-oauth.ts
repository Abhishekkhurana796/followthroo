/**
 * Verify the LinkedIn account connection — without touching any database.
 *
 *   npx tsx --env-file=.env.local scripts/verify-linkedin-oauth.ts
 *
 * Everything asserted here is pure: URL construction, token-lifetime state, and
 * the guardrail that the two new credential columns are registered for
 * encryption. That last one is the point of the file — a credential column that
 * misses ENCRYPTED_COLUMNS is stored in plaintext and nothing else complains.
 */
import { ENCRYPTED_COLUMNS } from "../lib/db-encryption";
import { decryptField, encryptField, fieldAad } from "../lib/crypto";
import {
  authorizeUrl,
  connectionState,
  daysUntil,
  expiryFrom,
  RECONNECT_WARNING_DAYS,
} from "../lib/linkedin/oauth";

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const day = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * day);

console.log("\nEncryption guardrail");
{
  const cols = ENCRYPTED_COLUMNS.linkedInAccount ?? [];
  check("liAccessToken is an encrypted column", cols.includes("liAccessToken"));
  check("liRefreshToken is an encrypted column", cols.includes("liRefreshToken"));

  // Round-trip through the same AAD the extension uses, so a mismatch between
  // this file and lib/db-encryption.ts shows up here rather than as an
  // undecryptable row in production.
  const secret = "AQV5P-1VTVVebnLl_SCiyMXoIjDmJ4s6rO1VBGP5Hx2542KaR";
  const aad = fieldAad("linkedInAccount", "liAccessToken");
  const sealed = encryptField(secret, aad);
  check("ciphertext does not contain the token", !sealed.includes(secret));
  check("round-trips under the column's AAD", decryptField(sealed, aad) === secret);

  // A token must not decrypt when moved to another column — that is the whole
  // reason the AAD binds the column name.
  let crossColumn = false;
  try {
    decryptField(sealed, fieldAad("linkedInAccount", "liRefreshToken"));
    crossColumn = true;
  } catch {
    /* expected */
  }
  check("refuses to decrypt under a different column's AAD", !crossColumn);
}

console.log("\nAuthorization URL");
{
  process.env.LINKEDIN_CLIENT_ID ||= "test-client-id";
  const url = new URL(
    authorizeUrl({ redirectUri: "https://app.followthroo.com/api/linkedin/oauth/callback", state: "abc123" }),
  );
  check("points at LinkedIn's consent endpoint", url.origin + url.pathname === "https://www.linkedin.com/oauth/v2/authorization");
  check("response_type=code", url.searchParams.get("response_type") === "code");
  check("carries the state nonce", url.searchParams.get("state") === "abc123");
  check(
    "redirect_uri is exact and unparameterised",
    url.searchParams.get("redirect_uri") === "https://app.followthroo.com/api/linkedin/oauth/callback",
  );
  check("never carries the client secret", !url.search.includes("secret"));
  const scopes = (url.searchParams.get("scope") ?? "").split(" ");
  check("requests identity", scopes.includes("openid") && scopes.includes("profile"));
  check("requests posting rights", scopes.includes("w_member_social"));
}

console.log("\nConnection state");
{
  check("no member id reads as disconnected", connectionState({ liMemberId: null }) === "disconnected");
  check(
    "a fresh 60-day token is connected",
    connectionState({ liMemberId: "x", liTokenExpiresAt: inDays(60) }) === "connected",
  );
  check(
    `${RECONNECT_WARNING_DAYS} days out warns rather than waiting for the failure`,
    connectionState({ liMemberId: "x", liTokenExpiresAt: inDays(RECONNECT_WARNING_DAYS - 1) }) === "expiring",
  );
  check(
    "a lapsed token reads as expired",
    connectionState({ liMemberId: "x", liTokenExpiresAt: inDays(-1) }) === "expired",
  );
  check(
    "a connection with no recorded expiry is not falsely reported as expired",
    connectionState({ liMemberId: "x", liTokenExpiresAt: null }) === "connected",
  );
}

console.log("\nToken lifetime arithmetic");
{
  const expiry = expiryFrom(5_184_000); // LinkedIn's documented 60 days
  check("60 days resolves to 59-60 days out", (daysUntil(expiry) ?? 0) >= 59);
  check("absent expires_in yields no expiry", expiryFrom(undefined) === null);
  check("zero expires_in yields no expiry", expiryFrom(0) === null);
}

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
