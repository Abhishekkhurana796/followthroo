/**
 * Connecting a LinkedIn account, officially.
 *
 * ---- What this is, and what it deliberately is not ----
 *
 * Competitors advertise "connect your LinkedIn account" and mean something
 * specific by it: the customer hands over their `li_at` session cookie, the
 * vendor stores it, and the vendor's cloud then browses LinkedIn as that person
 * from the vendor's own IP. That is what makes their unattended automation
 * work, and it is also why their customers' accounts get restricted — a session
 * used from a datacentre the member has never signed in from is the single
 * clearest signal LinkedIn's enforcement has.
 *
 * This module is the other kind of account connection: LinkedIn's own OAuth
 * consent screen, granting scopes LinkedIn actually issues. The member sees a
 * LinkedIn dialog, approves, and comes back with their real name and photo on
 * their Followthroo account.
 *
 * What it grants:
 *   - `openid` / `profile` / `email` — verified identity (Sign In with LinkedIn)
 *   - `w_member_social`              — post to their feed (Share on LinkedIn)
 *
 * What no LinkedIn API tier grants, at any price, to a non-partner:
 *   - reading search results, a company's employees, post likers, group members
 *   - sending connection invitations
 *   - sending messages
 *
 * That gap is why the Chrome extension still exists. The connection here is the
 * member's identity and their posting rights; the extension is how the reading
 * and drafting happens, inside their own logged-in tab. Both are real; neither
 * replaces the other.
 *
 * ---- Token lifetime ----
 *
 * Access tokens last 60 days. Refresh tokens are gated behind LinkedIn's
 * partner programme ("Programmatic Refresh Tokens"), so for an ordinary app
 * there is no refresh and the member reconnects every 60 days. We store the
 * expiry and surface it well before it lapses rather than discovering it as a
 * failed post.
 */

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

/**
 * Scopes to request.
 *
 * Overridable because scope availability is per-app: they depend on which
 * Products the app has been granted in LinkedIn's Developer Portal, and asking
 * for one the app does not hold fails the whole consent with "Invalid scope"
 * rather than degrading. An operator whose app has only Sign In approved can
 * set LINKEDIN_SCOPES="openid profile email" and still get a working connect.
 */
export const LINKEDIN_SCOPES =
  process.env.LINKEDIN_SCOPES?.trim() || "openid profile email w_member_social";

/**
 * The callback path, registered verbatim in LinkedIn's Developer Portal.
 *
 * It lives here rather than in the route module because a Next.js route file may
 * only export request handlers — exporting a constant from one fails the build
 * (and `tsc --noEmit` does not catch it).
 */
export const LINKEDIN_REDIRECT_PATH = "/api/linkedin/oauth/callback";

export function linkedinOAuthConfigured(): boolean {
  return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

export function authorizeUrl(opts: { redirectUri: string; state: string }): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.LINKEDIN_CLIENT_ID!);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("scope", LINKEDIN_SCOPES);
  return url.toString();
}

export interface LinkedInTokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<LinkedInTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    redirect_uri: redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as LinkedInTokens;
  if (!res.ok && !json.error) json.error = `token_exchange_http_${res.status}`;
  return json;
}

/** The OpenID Connect claims LinkedIn returns for the consenting member. */
export interface LinkedInMember {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
}

/**
 * Who consented.
 *
 * `sub` is LinkedIn's stable id for the person and is the only field guaranteed
 * to be there — `email` needs the `email` scope, `picture` is absent for members
 * with no photo. Everything downstream treats the rest as optional.
 */
export async function fetchMember(accessToken: string): Promise<LinkedInMember | null> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as LinkedInMember | null;
  return json?.sub ? json : null;
}

/** Absolute expiry from the relative `expires_in` LinkedIn returns. */
export function expiryFrom(expiresInSeconds: number | undefined): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

/** Days left on the connection; negative once it has lapsed. */
export function daysUntil(expiry: Date | null | undefined): number | null {
  if (!expiry) return null;
  return Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
}

/**
 * Warn while there is still time to act.
 *
 * Seven days is chosen so a member who only opens the app on weekdays still
 * sees it twice before anything breaks.
 */
export const RECONNECT_WARNING_DAYS = 7;

export function connectionState(account: {
  liMemberId?: string | null;
  liTokenExpiresAt?: Date | null;
}): "disconnected" | "expiring" | "expired" | "connected" {
  if (!account.liMemberId) return "disconnected";
  const days = daysUntil(account.liTokenExpiresAt ?? null);
  if (days === null) return "connected";
  if (days < 0) return "expired";
  return days <= RECONNECT_WARNING_DAYS ? "expiring" : "connected";
}
