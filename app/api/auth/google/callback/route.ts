import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env, configured } from "@/lib/env";
import { requireLimit } from "@/lib/billing/limits";

export const runtime = "nodejs";

function backTo(kind: "connected" | "error", detail?: string, domainId?: string | null) {
  // Started from the sending-domain wizard? Return to it, on the step they were
  // on. Dropping them on the Accounts list mid-flow loses their place.
  const url = domainId
    ? new URL(`${env.appUrl}/dashboard/accounts/new?step=mailbox&domain=${domainId}`)
    : new URL(`${env.appUrl}/dashboard/accounts`);
  url.searchParams.set(kind, detail ?? "1");
  return NextResponse.redirect(url.toString());
}

/** Decode a JWT payload (no signature check — token comes straight from Google over TLS). */
function decodeJwtEmail(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(json).email ?? null;
  } catch {
    return null;
  }
}

/**
 * Google OAuth callback. Exchanges the authorization code for tokens, resolves the
 * connected Gmail address, and stores it as a gmail_oauth SendingAccount. Sending
 * later uses the stored refresh token via nodemailer's OAuth2 transport.
 */
export async function GET(req: NextRequest) {
  if (!configured.google) return backTo("error", "google_not_configured");

  const params = req.nextUrl.searchParams;
  const err = params.get("error");
  if (err) return backTo("error", err);

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = req.cookies.get("g_oauth_state")?.value;
  const orgId = req.cookies.get("g_oauth_org")?.value;
  const userId = req.cookies.get("g_oauth_user")?.value;
  const domainId = req.cookies.get("g_oauth_domain")?.value ?? null;

  if (!code) return backTo("error", "missing_code");
  if (!state || !cookieState || state !== cookieState) return backTo("error", "state_mismatch");
  if (!orgId || !userId) return backTo("error", "no_org");

  try {
    const redirectUri = `${env.appUrl}/api/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.google.clientId!,
        client_secret: env.google.clientSecret!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("[google/callback] token exchange failed:", tokens);
      return backTo("error", tokens.error ?? "token_exchange_failed");
    }

    const refreshToken: string | undefined = tokens.refresh_token;
    const email = tokens.id_token ? decodeJwtEmail(tokens.id_token) : null;
    if (!email) return backTo("error", "no_email");

    const existing = await prisma.sendingAccount.findUnique({
      where: { organizationId_email: { organizationId: orgId, email } },
    });
    if (existing?.createdById && existing.createdById !== userId) return backTo("error", "mailbox_linked_to_another_member");
    // Google only returns a refresh_token on first consent; keep the stored one on re-connect.
    const effectiveRefresh = refreshToken ?? existing?.refreshToken;
    if (!effectiveRefresh) return backTo("error", "no_refresh_token");

    // Reconnecting a mailbox already here never needs room; a new one counts
    // against the plan's sending inboxes.
    if (!existing && (await requireLimit(orgId, "inboxes"))) return backTo("error", "plan_inbox_limit");

    // Only trust the cookie's domain if it still belongs to this org.
    const linkedDomainId = domainId
      ? (
          await prisma.domain.findFirst({
            where: { id: domainId, organizationId: orgId },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const account = await prisma.sendingAccount.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: {
        organizationId: orgId,
        createdById: userId,
        name: email,
        email,
        provider: "gmail_oauth",
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        user: email,
        refreshToken: effectiveRefresh,
        active: true,
        ...(existing?.createdById ? {} : { createdById: userId }),
        domainId: linkedDomainId,
      },
      update: {
        provider: "gmail_oauth",
        refreshToken: effectiveRefresh,
        active: true,
        ...(linkedDomainId ? { domainId: linkedDomainId } : {}),
      },
    });

    // Connected from the sending-domain flow means it is a fresh outreach
    // mailbox, so warm-up should already be running by the time they see it.
    if (linkedDomainId) {
      await prisma.warmup.upsert({
        where: { sendingAccountId: account.id },
        create: { organizationId: orgId, sendingAccountId: account.id, enabled: true },
        update: { enabled: true },
      });
    }

    const res = backTo("connected", email, linkedDomainId);
    res.cookies.delete("g_oauth_state");
    res.cookies.delete("g_oauth_org");
    res.cookies.delete("g_oauth_user");
    res.cookies.delete("g_oauth_domain");
    return res;
  } catch (e) {
    console.error("[google/callback] error:", e);
    return backTo("error", e instanceof Error ? e.message : "callback_failed");
  }
}
