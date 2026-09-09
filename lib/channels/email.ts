import { env, configured } from "../env";
import type { Channel, Lead, SendResult } from "./types";
import type { RenderedMessage } from "../templates";
import { formatEmailBody } from "../templates";

// --- Gmail OAuth sending via the Gmail API (messages.send) ---
// We use the Gmail API (not SMTP) because the connected accounts hold the
// `gmail.send` scope. Gmail's SMTP requires the broader `https://mail.google.com/`
// scope and rejects gmail.send with "535 BadCredentials".

/** Exchange a stored refresh token for a short-lived access token. */
export async function gmailAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId!,
      client_secret: env.google.clientSecret!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Gmail token refresh failed: ${j.error_description || j.error || res.status}`);
  }
  return j.access_token as string;
}

/** RFC 2047-encode a header value only if it contains non-ASCII. */
function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s;
}

/** Send one HTML email through the Gmail API; returns the Gmail message id. */
async function sendViaGmailApi(
  refreshToken: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  messageId?: string
): Promise<string> {
  const token = await gmailAccessToken(refreshToken);
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    // Our own Message-ID, so an inbound reply naming it in In-Reply-To can be
    // matched back to this exact send. Gmail assigns its own opaque id, which is
    // not the header the recipient's client will quote back at us.
    ...(messageId ? [`Message-ID: ${messageId}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail API send failed: ${j.error?.message || res.status}`);
  return j.id as string;
}

const NO_ACCOUNT =
  "No sending account connected. Connect a mailbox in Settings → Sending accounts before sending.";

/**
 * Internal mail: Followthroo notifying its OWN users (new-lead alerts, SLA escalations).
 *
 * This is the one legitimate use of the platform's SMTP credentials, and it is
 * deliberately a separate function from `emailChannel.send` so the distinction can't
 * blur: anything a *contact* receives must go out through a mailbox the workspace
 * connected, under their own domain and reputation. Nothing here is ever addressed to
 * a lead, so it bypasses suppression and the outbound rate limiter by design.
 */
export async function sendSystemEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!configured.email) return false;
  try {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user!, pass: env.smtp.pass! },
      ...(env.smtp.dkim.domainName && env.smtp.dkim.privateKey
        ? {
            dkim: {
              domainName: env.smtp.dkim.domainName,
              keySelector: env.smtp.dkim.keySelector,
              privateKey: env.smtp.dkim.privateKey,
            },
          }
        : {}),
    });
    await t.sendMail({ from: env.smtp.from, to, subject, html: formatEmailBody(body), text: body });
    return true;
  } catch (e) {
    console.error("[email] system notification failed:", e);
    return false;
  }
}

/**
 * The mailbox a workspace sends from when the caller didn't name one — its oldest
 * active account. Returns null when the org has connected none, which is a hard stop:
 * there is deliberately no platform-wide fallback mailbox (see the note on `send`).
 */
export async function defaultSendingAccountId(orgId: string): Promise<string | null> {
  if (!orgId || orgId === "global") return null;
  const { prisma } = await import("../db");
  const acc = await prisma.sendingAccount.findFirst({
    where: { organizationId: orgId, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return acc?.id ?? null;
}

export const emailChannel: Channel = {
  name: "email",
  isConfigured: () => configured.email,
  capabilities: () => ({ send: true, receive: true, templates: false, requiresOptIn: false }),

  /**
   * Every email goes out through a SendingAccount the workspace connected itself.
   *
   * There used to be a fallback to the platform's own SMTP creds (`env.smtp`) whenever
   * no account was named. It was removed because it was wrong in four ways at once:
   * mail left under Followthroo's From address rather than the customer's; the reply
   * poller only walks SendingAccount rows, so replies to that mailbox were never
   * captured and stop-on-reply silently never fired; deliverability reputation was
   * shared across every tenant; and the rate limiter keys on (org, account), so each
   * tenant got its own quota against one physical mailbox. A send with no connected
   * account now fails loudly instead of quietly doing the wrong thing.
   */
  async send(lead: Lead, rendered: RenderedMessage, account?: string, orgId?: string, rfcMessageId?: string): Promise<SendResult> {
    if (!lead.email) return { ok: false, skipped: true, reason: "lead has no email" };
    if (!account || account === "default") return { ok: false, skipped: true, reason: NO_ACCOUNT };
    // The account id is a bare uuid; without the owning org in the lookup, one tenant
    // could send through another tenant's connected mailbox.
    if (!orgId || orgId === "global") {
      return { ok: false, skipped: true, reason: "send attempted without an organization scope" };
    }

    // Plain-text template bodies → readable HTML paragraphs (idempotent for HTML bodies).
    const htmlBody = formatEmailBody(rendered.body);
    try {
      const { prisma } = await import("../db");
      const sendingAccount = await prisma.sendingAccount.findFirst({
        where: { id: account, organizationId: orgId },
      });
      if (!sendingAccount) {
        return { ok: false, skipped: true, reason: `Sending account ${account} not found` };
      }
      if (!sendingAccount.active) {
        return { ok: false, skipped: true, reason: `Sending account ${account} is inactive` };
      }
      const fromAddress = sendingAccount.from || `${sendingAccount.name} <${sendingAccount.email}>`;

      // Zoho OAuth accounts send through the Zoho Mail API. The account's region
      // and Zoho account id were resolved at connect time and stored on the row
      // (see app/api/auth/zoho/callback), so nothing is re-derived per send.
      if (sendingAccount.provider === "zoho_oauth") {
        if (!sendingAccount.refreshToken) {
          return { ok: false, skipped: true, reason: `Zoho account ${account} needs re-connect (no refresh token)` };
        }
        if (!sendingAccount.dkimSelector) {
          return { ok: false, skipped: true, reason: `Zoho account ${account} needs re-connect (no Zoho account id)` };
        }
        const { sendViaZohoMail, dcFromHost } = await import("../zoho");
        const id = await sendViaZohoMail({
          refreshToken: sendingAccount.refreshToken,
          dc: dcFromHost(sendingAccount.host),
          accountId: sendingAccount.dkimSelector,
          from: sendingAccount.email,
          to: lead.email,
          subject: rendered.subject ?? "",
          html: htmlBody,
          messageId: rfcMessageId,
        });
        return { ok: true, providerId: id, rfcMessageId };
      }

      // Gmail OAuth accounts send through the Gmail API (matches the gmail.send scope).
      if (sendingAccount.provider === "gmail_oauth") {
        if (!configured.google) {
          return { ok: false, error: "Google OAuth not configured on server" };
        }
        if (!sendingAccount.refreshToken) {
          return { ok: false, skipped: true, reason: `Gmail account ${account} needs re-connect (no refresh token)` };
        }
        const id = await sendViaGmailApi(
          sendingAccount.refreshToken,
          fromAddress,
          lead.email,
          rendered.subject ?? "",
          htmlBody,
          rfcMessageId
        );
        return { ok: true, providerId: id, rfcMessageId };
      }

      // SMTP account.
      if (!sendingAccount.host || !sendingAccount.user || !sendingAccount.pass) {
        return { ok: false, error: `SMTP account ${account} is missing host/user/pass` };
      }
      const nodemailer = await import("nodemailer");
      const t = nodemailer.createTransport({
        host: sendingAccount.host,
        port: sendingAccount.port,
        secure: sendingAccount.secure,
        auth: { user: sendingAccount.user, pass: sendingAccount.pass },
        // Per-account DKIM signing (improves deliverability) when configured.
        ...(sendingAccount.dkimDomain && sendingAccount.dkimPrivateKey
          ? {
              dkim: {
                domainName: sendingAccount.dkimDomain,
                keySelector: sendingAccount.dkimSelector || "default",
                privateKey: sendingAccount.dkimPrivateKey,
              },
            }
          : {}),
      });

      const info = await t.sendMail({
        from: fromAddress,
        to: lead.email,
        subject: rendered.subject ?? "",
        html: htmlBody,
        text: rendered.body.replace(/<[^>]+>/g, " "),
        // nodemailer generates one if we do not; we supply ours so the value is
        // known before the send and can be stored against the Message row.
        ...(rfcMessageId ? { messageId: rfcMessageId } : {}),
      });
      return { ok: true, providerId: info.messageId, rfcMessageId: rfcMessageId ?? info.messageId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
