import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { ZOHO_SCOPES, accountsHost, zohoConfigured, resolveDc } from "@/lib/zoho";

export const runtime = "nodejs";

/**
 * Start the Zoho consent flow for connecting a mailbox to send from.
 *
 * Distinct from signing in with Zoho, which better-auth's genericOAuth plugin
 * owns at /api/auth/oauth2/callback/zoho. Same split as Google: logging in and
 * granting us permission to send as you are two different consents, and
 * conflating them would ask every new user for mail-send access just to sign up.
 */
export async function GET(req: NextRequest) {
  if (!zohoConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET not configured" },
      { status: 503 }
    );
  }

  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const state = randomUUID();
  const redirectUri = `${env.appUrl}/api/auth/zoho/callback`;

  // Carry a sending domain through the round trip, as the Google flow does, so
  // the wizard returns to the step it left rather than the Accounts list.
  const domainId = req.nextUrl.searchParams.get("domain");
  const ownedDomainId = domainId
    ? (
        await prisma.domain.findFirst({
          where: { id: domainId, organizationId: ctx.orgId },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  // Consent is opened on our default DC; Zoho redirects the person to their own
  // region and tells us which one in the callback, so this is a starting point
  // rather than an assumption we hold onto.
  const dc = resolveDc(null, req.nextUrl.searchParams.get("dc"));

  const url = new URL(`${accountsHost(dc)}/oauth/v2/auth`);
  url.searchParams.set("client_id", process.env.ZOHO_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ZOHO_SCOPES);
  // Without offline + consent there is no refresh token, and the mailbox stops
  // sending about an hour later.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("z_oauth_state", state, cookieOpts);
  res.cookies.set("z_oauth_org", ctx.orgId, cookieOpts);
  if (ownedDomainId) res.cookies.set("z_oauth_domain", ownedDomainId, cookieOpts);
  return res;
}
