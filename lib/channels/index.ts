import { emailChannel } from "./email";
import { whatsappChannel } from "./whatsapp";
import { linkedinChannel } from "./linkedin";
import { socialChannel } from "./social";
import type { Channel, Lead, SendResult, SendContext } from "./types";
import type { RenderedMessage } from "../templates";
import { acquire } from "../ratelimit";
import { isSuppressed } from "../crm";
import { recordConversationEvent } from "../conversation";
import { isQuietHours } from "../quiet-hours";
import { charge, chargedRef, keepCredits, returnCredits } from "../billing/meter";
import type { CreditAction } from "../billing/plans";

export const channels: Record<Channel["name"], Channel> = {
  email: emailChannel,
  whatsapp: whatsappChannel,
  linkedin: linkedinChannel,
  social: socialChannel,
};

export type { Channel, Lead, SendResult };

/**
 * What a send costs, by channel.
 *
 * LinkedIn is missing on purpose. Its send() only queues an action, and the
 * invitation is paid for when the desktop app is handed it (claimActions in
 * lib/linkedin/queue.ts) — charging here as well would bill a queued row. Social
 * has no working adapter.
 */
const SEND_CREDITS: Partial<Record<Channel["name"], CreditAction>> = {
  email: "email_send",
  whatsapp: "whatsapp_send",
};

/**
 * Safe send: enforces suppression, credits and the rate limit before delegating
 * to the channel. This is the ONLY function callers (API routes, worker, agent)
 * should use.
 */
export async function safeSend(
  channelName: Channel["name"],
  lead: Lead,
  rendered: RenderedMessage,
  account = "default",
  orgId = "global",
  /** RFC-822 Message-ID to stamp on the outgoing mail, so a reply can be
   *  matched back to this exact send (lib/inbox/threading.ts). Email only. */
  rfcMessageId?: string,
  /** Which campaign/step this came from, and for LinkedIn which gesture to draft. */
  ctx?: SendContext
): Promise<SendResult> {
  const channel = channels[channelName];

  if (await isSuppressed(orgId, { email: lead.email, phone: lead.phone, linkedinUrl: lead.linkedinUrl })) {
    return { ok: false, skipped: true, reason: "suppressed" };
  }

  if (channelName === "whatsapp" && isQuietHours(lead.phone)) {
    return { ok: false, skipped: true, reason: "quiet hours at the contact's estimated local time" };
  }

  // Credits, before the rate limiter: credits can be handed back and a
  // rate-limit slot can't, so a send refused for credits doesn't use up the
  // hour's quota, and one the limiter refuses gets its credit back.
  //
  // Charged unless the caller says it's free, which is only for sends a person
  // makes by hand for themselves (SendContext.free). A new caller that never
  // thought about credits pays, rather than sending for nothing.
  const creditAction = SEND_CREDITS[channelName];
  const paid =
    creditAction && !ctx?.free && orgId !== "global"
      ? await charge(orgId, creditAction, {
          meta: { channel: channelName, leadId: lead.id, campaignId: ctx?.campaignId ?? null, messageId: ctx?.messageId ?? null },
        })
      : null;
  if (paid && !paid.ok) return { ok: false, skipped: true, reason: paid.reason, error: paid.message };

  // LinkedIn is deliberately exempt from this limiter.
  //
  // For email and WhatsApp, `channel.send()` actually sends, so spending quota
  // here is spending it on a real message. LinkedIn's send() only *enqueues* a
  // LinkedInAction — the invitation happens later, on the customer's own
  // machine, and the daily cap that governs it is enforced where that decision
  // is made: claimActions in lib/linkedin/queue.ts, against the account's
  // dailyInviteCap.
  //
  // Charging both meant a campaign could exhaust a 20/day bucket on twenty rows
  // that were merely queued, and every further step came back "rate-limited"
  // for a send that had not happened. Worse, the two paths disagreed: bulk
  // enqueue from the Leads screen goes through enqueueManyLinkedIn and never
  // touched this limiter at all, so the same twenty leads counted once or twice
  // depending on which screen you started from. One cap, in one place.
  if (channelName !== "linkedin") {
    const quota = await acquire(channelName, account, orgId);
    if (!quota.ok) {
      await returnCredits(orgId, chargedRef(paid), "rate-limited");
      return {
        ok: false,
        skipped: true,
        reason: `rate-limited; retry in ${Math.ceil(quota.retryAfterMs / 1000)}s`,
      };
    }
  }

  // orgId goes to the adapter too: per-tenant credentials must be looked up scoped to
  // the owning org, never by a bare account id.
  let result: SendResult;
  try {
    result = await channel.send(lead, rendered, account, orgId, rfcMessageId, ctx);
  } catch (e) {
    await returnCredits(orgId, chargedRef(paid), "the send threw");
    throw e;
  }
  if (result.ok && !result.skipped) await keepCredits(orgId, chargedRef(paid));
  else await returnCredits(orgId, chargedRef(paid), result.reason ?? result.error ?? "not sent");

  // LinkedIn's "ok" here means "queued for the extension to draft," not "a human actually
  // sent it" — that confirmation writes its own ConversationEvent later, from
  // lib/linkedin/queue.ts::completeAction, once the person clicks "I sent it."
  if (result.ok && !result.skipped && channelName !== "linkedin") {
    await recordConversationEvent({
      organizationId: orgId,
      leadId: lead.id,
      channel: channelName,
      direction: "outbound",
      subject: rendered.subject ?? null,
      body: rendered.body ?? null,
      status: "sent",
      externalId: result.providerId ?? null,
    });
  }

  return result;
}
