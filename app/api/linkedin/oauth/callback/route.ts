import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getOrCreateAccount } from "@/lib/linkedin/auth";
import {
  exchangeCode,
  expiryFrom,
  fetchMember,
  linkedinOAuthConfigured,
  LINKEDIN_REDIRECT_PATH,
} from "@/lib/linkedin/oauth";

export const runtime = "nodejs";

function backTo(kind: "connected" | "error", detail?: string) {
  const url = new URL(`${env.appUrl}/dashboard/linkedin`);
  url.searchParams.set(kind, detail ?? "1");
  return NextResponse.redirect(url.toString());
}

/**
 * LinkedIn consent callback.
 *
 * Tokens land on the member's own LinkedInAccount row, encrypted by the Prisma
 * extension on the way in (`liAccessToken` / `liRefreshToken` are registered in
 * lib/db-encryption.ts). Nothing here is ever returned to a browser — the
 * settings API sends back a name, a photo and an expiry date, never the token.
 */
export async function GET(req: NextRequest) {
  if (!linkedinOAuthConfigured()) return backTo("error", "linkedin_not_configured");

  const params = req.nextUrl.searchParams;

  // LinkedIn distinguishes "declined to log in" from "declined the permissions",
  // and both are ordinary member choices rather than faults — pass them through
  // so the page can say so plainly instead of showing a failure.
  const err = params.get("error");
  if (err) return backTo("error", err);

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = req.cookies.get("li_oauth_state")?.value;
  const orgId = req.cookies.get("li_oauth_org")?.value;
  const userId = req.cookies.get("li_oauth_user")?.value;

  if (!code) return backTo("error", "missing_code");
  if (!state || !cookieState || state !== cookieState) return backTo("error", "state_mismatch");
  if (!orgId || !userId) return backTo("error", "no_session");

  try {
    const redirectUri = `${env.appUrl}${LINKEDIN_REDIRECT_PATH}`;
    const tokens = await exchangeCode(code, redirectUri);
    if (!tokens.access_token) {
      console.error("[linkedin/oauth] token exchange failed:", tokens.error, tokens.error_description);
      return backTo("error", tokens.error ?? "token_exchange_failed");
    }

    // Confirm the token actually works before calling anything connected. A row
    // that claims a connection and then fails on the first post is worse than
    // refusing here, where the member is still present and can retry.
    const member = await fetchMember(tokens.access_token);
    if (!member) return backTo("error", "could_not_read_profile");

    // One LinkedIn identity per member per workspace. Connecting a second
    // LinkedIn simply replaces the first rather than silently accumulating
    // tokens whose owner nobody can tell apart later.
    const account = await getOrCreateAccount(orgId, userId);
    await prisma.linkedInAccount.update({
      where: { id: account.id },
      data: {
        liMemberId: member.sub,
        liMemberName: member.name || [member.given_name, member.family_name].filter(Boolean).join(" ") || null,
        liPictureUrl: member.picture ?? null,
        liEmail: member.email ?? null,
        liAccessToken: tokens.access_token,
        liRefreshToken: tokens.refresh_token ?? null,
        liTokenExpiresAt: expiryFrom(tokens.expires_in),
        liScopes: tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : [],
        liConnectedAt: new Date(),
      },
    });

    const res = backTo("connected", member.name ?? "1");
    res.cookies.delete("li_oauth_state");
    res.cookies.delete("li_oauth_org");
    res.cookies.delete("li_oauth_user");
    return res;
  } catch (e) {
    console.error("[linkedin/oauth] callback error:", e);
    return backTo("error", e instanceof Error ? e.message : "callback_failed");
  }
}
