import { prisma } from "../db";
import type { Channel, Lead, SendResult, SendContext } from "./types";
import type { RenderedMessage } from "../templates";
import { enqueueLinkedInAction } from "../linkedin/queue";
import { INVITE_NOTE_MAX } from "../linkedin/note";

/**
 * The text a queued LinkedIn action carries.
 *
 * A message step sends the lead's own saved message when there is one — written
 * by AI or by hand on the Leads screen — and otherwise the step's template, as
 * it always did, so no lead is held up for lack of one. Invitations keep using
 * the template: a saved message is a direct message, and LinkedIn caps an
 * invitation note at 300 characters.
 */
export function stepNote(input: {
  kind: string;
  noteFor?: string;
  savedMessage?: string | null;
  rendered: RenderedMessage;
}): string | null {
  if (input.noteFor === "none") return null;
  const saved = input.kind === "message" ? input.savedMessage?.trim() : "";
  return saved || input.rendered.body || input.rendered.subject || null;
}

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
      select: { organizationId: true, linkedinUrl: true, linkedinMessage: true },
    });
    if (!dbLead?.organizationId) return { ok: false, skipped: true, reason: "lead has no organization" };

    const kind = ctx?.linkedinAction ?? "auto";
    // A step set to "No one" sends plain connection requests: the template is
    // not a note there, so it is neither stored nor held to the 300 limit.
    const noteFor = kind === "message" ? undefined : ctx?.noteFor;
    const note = stepNote({ kind, noteFor, savedMessage: dbLead.linkedinMessage, rendered });

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
      // Absent on steps saved before "Add a note for" existed: null keeps the old
      // meaning, a note whenever there is one.
      noteChoice: noteFor === undefined ? null : !note ? "no" : noteFor === "picked" ? "undecided" : "yes",
    });
    return { ok: true, providerId: action.id, reason: "queued for the LinkedIn extension" };
  },
};
