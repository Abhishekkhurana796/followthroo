import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env, configured } from "@/lib/env";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  // gmail.modify grants read + label changes (reply polling + warm-up placement /
  // spam-rescue). Existing accounts connected before this change must reconnect.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

/**
 * Kick off the Google OAuth consent flow for connecting a Gmail sending account.
 * Redirects the browser to Google's consent screen. On approval Google calls
 * /api/auth/google/callback with an authorization code.
 */
export async function GET(req: NextRequest) {
  if (!configured.google) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured" },
      { status: 503 }
    );
  }

  // Remember which org is connecting so the callback stores the account in it.
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const state = randomUUID();
  const redirectUri = `${env.appUrl}/api/auth/google/callback`;

  // Optional: when the connect was started from the sending-domain wizard, carry
  // the domain through the round trip so the callback can link the mailbox to it
  // and return the user to the step they left, rather than the Accounts list.
  const domainId = req.nextUrl.searchParams.get("domain");
  const ownedDomainId = domainId
    ? (
        await prisma.domain.findFirst({
          where: { id: domainId, organizationId: ctx.orgId },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.google.clientId!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline"); // request a refresh token
  url.searchParams.set("prompt", "consent"); // force refresh token every time
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  // Short-lived CSRF cookie, validated in the callback.
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("g_oauth_state", state, cookieOpts);
  res.cookies.set("g_oauth_org", ctx.orgId, cookieOpts);
  res.cookies.set("g_oauth_user", ctx.userId, cookieOpts);
  if (ownedDomainId) res.cookies.set("g_oauth_domain", ownedDomainId, cookieOpts);
  return res;
}
