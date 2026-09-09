/**
 * Zoho OAuth + Mail, and the datacenter problem that makes it different from Google.
 *
 * Zoho is region-partitioned. An account created in India lives on `.in`, and its
 * tokens are ONLY valid against `.in` endpoints — authenticate against
 * accounts.zoho.com with an Indian account and the token exchange fails with an
 * "invalid_code" that says nothing about why. Google has no equivalent, which is
 * why this is the one part of the flow that cannot be copied across.
 *
 * The consent redirect tells us which DC the person actually belongs to, via an
 * `accounts-server` (sometimes `location`) parameter. We read it rather than
 * guessing, and store the resolved hosts on the SendingAccount so every later
 * send and poll goes to the right region without re-deriving it.
 */

/** Zoho's regional top-level domains. `.com` is the US/global default. */
const DC_DOMAINS = ["com", "in", "eu", "com.au", "jp", "ca", "sa"] as const;
export type ZohoDc = (typeof DC_DOMAINS)[number];

const DEFAULT_DC: ZohoDc = (process.env.ZOHO_DC as ZohoDc) || "in";

export function isZohoDc(value: string): value is ZohoDc {
  return (DC_DOMAINS as readonly string[]).includes(value);
}

/**
 * Pull the datacenter out of whatever the consent redirect gave us.
 *
 * `accounts-server` arrives as a full URL (https://accounts.zoho.in);
 * `location` arrives as a bare region code ("in", "us"). Both appear in the
 * wild depending on the flow, so both are handled.
 */
export function resolveDc(accountsServer?: string | null, location?: string | null): ZohoDc {
  if (accountsServer) {
    const m = accountsServer.match(/accounts\.zoho\.([a-z.]+)/i);
    if (m && isZohoDc(m[1])) return m[1];
  }
  if (location) {
    const loc = location.toLowerCase();
    // Zoho reports the US region as "us", but its domain is .com.
    if (loc === "us") return "com";
    if (isZohoDc(loc)) return loc;
  }
  return DEFAULT_DC;
}

export const accountsHost = (dc: ZohoDc) => `https://accounts.zoho.${dc}`;
export const mailApiHost = (dc: ZohoDc) => `https://mail.zoho.${dc}`;
export const imapHost = (dc: ZohoDc) => `imap.zoho.${dc}`;

/**
 * Recover the DC from a stored SendingAccount.
 *
 * The host columns do double duty here: `host` holds the region's mail API host
 * so nothing has to re-derive it at send time. Reusing an existing column beats
 * a migration for a value that is, literally, a host.
 */
export function dcFromHost(host: string | null | undefined): ZohoDc {
  const m = host?.match(/mail\.zoho\.([a-z.]+)/i);
  return m && isZohoDc(m[1]) ? m[1] : DEFAULT_DC;
}

/**
 * Scopes.
 *
 * `messages.CREATE` sends. `accounts.READ` is what resolves the account id and
 * the primary address — the send endpoint is keyed by account id, so without it
 * we would know the token but not where to post. `offline` on the auth request
 * is what yields a refresh token; without it a connected mailbox stops sending
 * roughly an hour later, which is the trap in Zoho's "Client-based" app type.
 */
export const ZOHO_SCOPES = ["ZohoMail.messages.CREATE", "ZohoMail.accounts.READ"].join(",");

export const zohoConfigured = () => !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

/** Exchange an authorization code for tokens, against the caller's own DC. */
export async function exchangeCode(code: string, redirectUri: string, dc: ZohoDc): Promise<TokenResponse> {
  const res = await fetch(`${accountsHost(dc)}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

/** Refresh tokens do not expire, but access tokens last an hour. */
export async function zohoAccessToken(refreshToken: string, dc: ZohoDc): Promise<string> {
  const res = await fetch(`${accountsHost(dc)}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!json.access_token) throw new Error(`Zoho token refresh failed: ${json.error ?? res.status}`);
  return json.access_token;
}

export interface ZohoAccount {
  accountId: string;
  primaryEmail: string;
  displayName: string | null;
}

/** The connected mailbox's id and address — the send endpoint is keyed by id. */
export async function fetchZohoAccount(accessToken: string, dc: ZohoDc): Promise<ZohoAccount | null> {
  const res = await fetch(`${mailApiHost(dc)}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  const first = json?.data?.[0];
  if (!first) return null;
  return {
    accountId: String(first.accountId),
    primaryEmail: String(first.primaryEmailAddress ?? first.mailboxAddress ?? "").toLowerCase(),
    displayName: first.displayName ?? null,
  };
}

/**
 * Send one message through the Zoho Mail API.
 *
 * `messageId` is our own RFC-822 Message-ID (lib/inbox/threading.ts) — Zoho
 * accepts extra headers, and without it a reply cannot be matched back to the
 * send that caused it.
 */
export async function sendViaZohoMail(args: {
  refreshToken: string;
  dc: ZohoDc;
  accountId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  messageId?: string;
}): Promise<string> {
  const token = await zohoAccessToken(args.refreshToken, args.dc);
  const res = await fetch(`${mailApiHost(args.dc)}/api/accounts/${args.accountId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fromAddress: args.from,
      toAddress: args.to,
      subject: args.subject,
      content: args.html,
      mailFormat: "html",
      ...(args.messageId ? { extraHeaders: [{ name: "Message-ID", value: args.messageId }] } : {}),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status?.code >= 400) {
    throw new Error(`Zoho send failed: ${json?.data?.errorCode ?? json?.status?.description ?? res.status}`);
  }
  return String(json?.data?.messageId ?? json?.data?.msgId ?? "");
}
