import { prisma } from "../db";
import type { Channel, Lead, SendResult, SendContext } from "./types";
import type { RenderedMessage } from "../templates";
import { enqueueLinkedInAction } from "../linkedin/queue";
import { INVITE_NOTE_MAX } from "../linkedin/note";

/**
 * LinkedIn sending is handled by the companion Chrome extension, not a server API —
 * LinkedIn does not grant invite/DM access through the developer program (see
 * docs/channels.md). A "send" here enqueues a LinkedInAction; the extension, running in
 * the user's own logged-in LinkedIn tab, claims it via /api/linkedin/queue and performs
 * the invite/message with humanized pacing + daily caps.
 */
export const linkedinChannel: Channel = {
  name: "linkedin",
  // Automation is client-side (the extension), so there are no server creds to gate on.
  isConfigured: () => true,
  // humanAssisted is no longer aspirational — the extension drafts and a person sends.
  capabilities: () => ({ send: true, receive: false, templates: false, requiresOptIn: false, humanAssisted: true }),

  async send(
    lead: Lead,
    rendered: RenderedMessage,
    _account?: string,
    _orgId?: string,
    _rfcMessageId?: string,
    ctx?: SendContext,
  ): Promise<SendResult> {
    if (!lead.linkedinUrl) return { ok: false, skipped: true, reason: "lead has no linkedinUrl" };

    const dbLead = await prisma.lead.findUnique({
      where: { id: lead.id },
      select: { organizationId: true, linkedinUrl: true },
    });
    if (!dbLead?.organizationId) return { ok: false, skipped: true, reason: "lead has no organization" };

    const kind = ctx?.linkedinAction ?? "auto";
    const note = rendered.body || rendered.subject || null;

    // The 300-character ceiling is LinkedIn's, and it only applies to an invite
    // note — a DM has room for thousands. Refusing here rather than letting the
    // extension truncate mid-sentence means an over-long note shows up as a
    // failed step you can see, not a message that quietly went out half-written.
    if (kind === "invite" && note && note.length > INVITE_NOTE_MAX) {
      return {
        ok: false,
        error: `Connection note is ${note.length} characters after personalisation; LinkedIn allows ${INVITE_NOTE_MAX}.`,
      };
    }

    const action = await enqueueLinkedInAction({
      organizationId: dbLead.organizationId,
      leadId: lead.id,
      linkedinUrl: dbLead.linkedinUrl ?? lead.linkedinUrl,
      note,
      // Both of these used to be dropped, so every campaign-driven action landed
      // as `campaignId: null, type: "auto"` and per-campaign caps applied to
      // nothing at all.
      campaignId: ctx?.campaignId ?? null,
      type: kind,
    });
    return { ok: true, providerId: action.id, reason: "queued for the LinkedIn extension" };
  },
};
