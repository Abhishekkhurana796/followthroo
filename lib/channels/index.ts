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

export const channels: Record<Channel["name"], Channel> = {
  email: emailChannel,
  whatsapp: whatsappChannel,
  linkedin: linkedinChannel,
  social: socialChannel,
};

export type { Channel, Lead, SendResult };

/**
 * Safe send: enforces suppression + rate limit before delegating to the channel.
 * This is the ONLY function callers (API routes, worker, agent) should use.
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
      return {
        ok: false,
        skipped: true,
        reason: `rate-limited; retry in ${Math.ceil(quota.retryAfterMs / 1000)}s`,
      };
    }
  }

  // orgId goes to the adapter too: per-tenant credentials must be looked up scoped to
  // the owning org, never by a bare account id.
  const result = await channel.send(lead, rendered, account, orgId, rfcMessageId, ctx);

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
