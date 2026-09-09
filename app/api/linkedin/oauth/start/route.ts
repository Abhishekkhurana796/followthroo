import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { requireOrg } from "@/lib/tenant";
import { authorizeUrl, linkedinOAuthConfigured, LINKEDIN_REDIRECT_PATH } from "@/lib/linkedin/oauth";

export const runtime = "nodejs";

/**
 * Begin "Connect LinkedIn account".
 *
 * Separate from signing in with LinkedIn, for the same reason the Zoho mailbox
 * flow is separate from signing in with Zoho: logging in and granting us the
 * right to post as you are two different consents, and merging them would ask
 * every new signup for posting rights just to create an account.
 *
 * The redirect URI must be registered verbatim in the LinkedIn Developer Portal
 * under Auth → Authorized redirect URLs. LinkedIn ignores query parameters on
 * it, so the member's identity travels in httpOnly cookies instead of the URL.
 */
export async function GET(req: NextRequest) {
  if (!linkedinOAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not configured" },
      { status: 503 },
    );
  }

  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const state = randomUUID();
  const redirectUri = `${env.appUrl}${LINKEDIN_REDIRECT_PATH}`;

  const res = NextResponse.redirect(authorizeUrl({ redirectUri, state }));
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("li_oauth_state", state, cookieOpts);
  res.cookies.set("li_oauth_org", ctx.orgId, cookieOpts);
  // The connection belongs to one member, not the workspace — two reps in the
  // same org each connect their own LinkedIn, so the callback must know which
  // of them started this and cannot re-derive it from the org alone.
  res.cookies.set("li_oauth_user", ctx.userId, cookieOpts);
  return res;
}
