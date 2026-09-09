import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, requireDb } from "@/lib/http";
import { suppress, logActivity } from "@/lib/crm";
import { verifyBodyHmac, verifySharedSecret } from "@/lib/webhook-auth";

export const runtime = "nodejs";

/**
 * Email provider webhook (bounces / complaints / opens). Shape varies by
 * provider (SendGrid / Mailgun / SES), so `event`, `email` and `messageId` are
 * normalized below.
 *
 * Authentication: an HMAC-SHA256 of the raw body in `X-Webhook-Signature`, or a
 * shared secret in `X-Webhook-Secret` / `?key=`. Both read EMAIL_WEBHOOK_SECRET
 * and both are constant-time. With no secret configured the endpoint rejects
 * everything — this route suppresses contacts, and an open one lets anyone
 * bounce another workspace's list into silence.
 */
export async function POST(req: NextRequest) {
  const guard = requireDb();
  if (guard) return guard;

  // Read the body once, as text: the HMAC must be computed over exactly the
  // bytes sent, not over a re-serialized object.
  const raw = await req.text();
  const signed =
    verifyBodyHmac(raw, req.headers.get("x-webhook-signature"), process.env.EMAIL_WEBHOOK_SECRET) ||
    verifySharedSecret(req, "EMAIL_WEBHOOK_SECRET");
  if (!signed) return fail("Invalid signature.", 401);

  let events: unknown;
  try {
    events = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON.", 400);
  }
  const list = Array.isArray(events) ? events : [events];

  for (const e of list as Record<string, unknown>[]) {
    const email = (e.email ?? e.recipient) as string | undefined;
    const event = String(e.event ?? e.type ?? "").toLowerCase();
    if (!email) continue;

    // The provider payload carries no tenant — resolve org(s) from the matching lead(s).
    const leads = await prisma.lead.findMany({ where: { email } });
    const isSuppression = event.includes("bounce") || event.includes("complaint") || event.includes("spam");

    for (const lead of leads) {
      if (!lead.organizationId) continue;
      if (isSuppression) {
        await suppress(lead.organizationId, { email }, event.includes("bounce") ? "bounce" : "unsubscribe");
      }
      await logActivity({
        organizationId: lead.organizationId,
        leadId: lead.id,
        type: event || "email_event",
        channel: "email",
        meta: e,
      });
    }
  }
  return ok({ processed: list.length });
}
