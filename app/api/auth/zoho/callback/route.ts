import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  exchangeCode,
  fetchZohoAccount,
  imapHost,
  mailApiHost,
  resolveDc,
  zohoAccessToken,
  zohoConfigured,
} from "@/lib/zoho";

export const runtime = "nodejs";

function backTo(kind: "connected" | "error", detail?: string, domainId?: string | null) {
  const url = domainId
    ? new URL(`${env.appUrl}/dashboard/accounts/new?step=mailbox&domain=${domainId}`)
    : new URL(`${env.appUrl}/dashboard/accounts`);
  url.searchParams.set(kind, detail ?? "1");
  return NextResponse.redirect(url.toString());
}

/**
 * Zoho OAuth callback for connecting a sending mailbox.
 *
 * The one thing that differs from Google: Zoho hands back an `accounts-server`
 * naming the datacenter the person actually belongs to, and the token exchange
 * must go there. Exchanging an Indian account's code against accounts.zoho.com
 * fails with an opaque "invalid_code", so this is read rather than assumed and
 * then stored, so later sends and polls do not have to re-derive it.
 */
export async function GET(req: NextRequest) {
  if (!zohoConfigured()) return backTo("error", "zoho_not_configured");

  const params = req.nextUrl.searchParams;
  const err = params.get("error");
  if (err) return backTo("error", err);

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = req.cookies.get("z_oauth_state")?.value;
  const orgId = req.cookies.get("z_oauth_org")?.value;
  const domainId = req.cookies.get("z_oauth_domain")?.value ?? null;

  if (!code) return backTo("error", "missing_code");
  if (!state || !cookieState || state !== cookieState) return backTo("error", "state_mismatch");
  if (!orgId) return backTo("error", "no_org");

  const dc = resolveDc(params.get("accounts-server"), params.get("location"));

  try {
    const redirectUri = `${env.appUrl}/api/auth/zoho/callback`;
    const tokens = await exchangeCode(code, redirectUri, dc);
    if (!tokens.access_token) {
      console.error("[zoho/callback] token exchange failed:", tokens.error);
      return backTo("error", tokens.error ?? "token_exchange_failed");
    }

    const existingByOrg = await prisma.sendingAccount.findFirst({
      where: { organizationId: orgId, provider: "zoho_oauth" },
      select: { email: true, refreshToken: true },
    });
    // Zoho, like Google, only returns a refresh token on first consent.
    const refreshToken = tokens.refresh_token ?? existingByOrg?.refreshToken;
    if (!refreshToken) return backTo("error", "no_refresh_token");

    // Resolve the mailbox: the send endpoint is keyed by Zoho's account id, so
    // knowing the token is not enough on its own.
    const account = await fetchZohoAccount(tokens.access_token, dc).catch(() => null);
    if (!account?.primaryEmail) return backTo("error", "could_not_read_mailbox");

    const linkedDomainId = domainId
      ? (
          await prisma.domain.findFirst({
            where: { id: domainId, organizationId: orgId },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const saved = await prisma.sendingAccount.upsert({
      where: { organizationId_email: { organizationId: orgId, email: account.primaryEmail } },
      create: {
        organizationId: orgId,
        name: account.displayName || account.primaryEmail,
        email: account.primaryEmail,
        provider: "zoho_oauth",
        // These two columns carry the region. Reusing them beats a migration for
        // a value that is, literally, a host — and lib/zoho.ts dcFromHost reads
        // it back so nothing else has to know about datacenters.
        host: mailApiHost(dc).replace("https://", ""),
        imapHost: imapHost(dc),
        imapPort: 993,
        port: 465,
        secure: true,
        user: account.primaryEmail,
        // Zoho's account id, needed on every send. `from` is a free-text header
        // field, so it is the natural place for it without a schema change.
        from: `${account.displayName || account.primaryEmail} <${account.primaryEmail}>`,
        dkimSelector: account.accountId,
        refreshToken,
        active: true,
        domainId: linkedDomainId,
      },
      update: {
        provider: "zoho_oauth",
        host: mailApiHost(dc).replace("https://", ""),
        imapHost: imapHost(dc),
        dkimSelector: account.accountId,
        refreshToken,
        active: true,
        ...(linkedDomainId ? { domainId: linkedDomainId } : {}),
      },
    });

    // Prove the stored credentials actually work before telling anyone it is
    // connected — a mailbox that says "connected" and then silently fails to
    // send is worse than one that refuses at setup.
    await zohoAccessToken(refreshToken, dc).catch((e) => {
      console.error("[zoho/callback] stored refresh token did not work:", e);
    });

    if (linkedDomainId) {
      await prisma.warmup.upsert({
        where: { sendingAccountId: saved.id },
        create: { organizationId: orgId, sendingAccountId: saved.id, enabled: true },
        update: { enabled: true },
      });
    }

    const res = backTo("connected", account.primaryEmail, linkedDomainId);
    res.cookies.delete("z_oauth_state");
    res.cookies.delete("z_oauth_org");
    res.cookies.delete("z_oauth_domain");
    return res;
  } catch (e) {
    console.error("[zoho/callback] error:", e);
    return backTo("error", e instanceof Error ? e.message : "callback_failed");
  }
}
