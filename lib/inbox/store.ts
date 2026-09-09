/**
 * Inbox store — records inbound/outbound messages into unified threads.
 * Shared by the reply poller (inbound) and the send path (outbound).
 *
 * ---- What counts as a reply ----
 *
 * This used to be one line: any inbound mail whose From matched a Lead.email
 * became `ActivityLog(type:"replied")`, moved the lead to the `replied` stage,
 * and stopped their sequence. That is wrong in both directions. A contact
 * sending an unrelated new enquiry silently killed their sequence; a genuine
 * reply from an alias or a forwarded thread was missed, so we kept emailing
 * somebody who had already answered.
 *
 * Now the match runs as a cascade, most certain first:
 *
 *   1. header  — an id in In-Reply-To/References names a Message we sent.
 *                A VERIFIED reply: attributed to that message and its campaign,
 *                and the only thing that stops a sequence.
 *   2. thread  — names a message already on a thread we know. Recorded and
 *                shown, but not a new campaign reply.
 *   3. address — the From address resolves to a contact, nothing more. A new
 *                inbound message: it appears in the inbox, raises a follow-up
 *                task, and does NOT touch the sequence.
 *   4. none    — unknown sender.
 *
 * The product promise ("a reply anywhere pauses the rest for that lead") is
 * kept: the halt is still lead-wide across campaigns. What changed is that only
 * case 1 satisfies it.
 */
import { prisma } from "../db";
import { logActivity } from "../crm";
import { recordConversationEvent } from "../conversation";
import { recomputeAndSaveLeadScore } from "../scoring";
import { classifyReplyIntent } from "../agent";
import { parseMessageIds, normalizeMessageId, isVerifiedReply, type MatchKind } from "./threading";
import type { Channel } from "@prisma/client";

interface InboundInput {
  fromAddr: string;
  toAddr?: string;
  subject?: string;
  body?: string;
  providerMessageId?: string;
  channel?: Channel;
  sentAt?: Date;
  /** RFC-822 headers, when the provider gave them to us. */
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface InboundResult {
  recorded: boolean;
  matched: boolean;
  /** How it was tied to us — see the cascade above. */
  matchKind: MatchKind;
  /** Set when matchKind is "header": the Message this answers. */
  repliedToMessageId?: string;
  campaignId?: string;
}

/** Find the org's lead whose email matches an inbound From address. */
async function matchLeadByAddress(orgId: string, fromAddr: string) {
  const email = fromAddr.toLowerCase();
  return prisma.lead.findFirst({ where: { organizationId: orgId, email } });
}

/**
 * Case 1: does any id this mail references name a message we actually sent?
 * This is the only evidence that turns an inbound mail into a campaign reply.
 */
async function matchSentMessage(orgId: string, ids: string[]) {
  if (ids.length === 0) return null;
  return prisma.message.findFirst({
    where: { organizationId: orgId, rfcMessageId: { in: ids.map((id) => `<${id}>`) } },
    select: { id: true, leadId: true, campaignId: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Case 2: does it continue a thread we already have? */
async function matchKnownThread(orgId: string, ids: string[]) {
  if (ids.length === 0) return null;
  return prisma.inboxMessage.findFirst({
    where: { organizationId: orgId, rfcMessageId: { in: ids.map((id) => `<${id}>`) } },
    select: { threadId: true },
    orderBy: { createdAt: "desc" },
  });
}

async function threadForLead(orgId: string, leadId: string, channel: Channel, subject?: string) {
  const existing = await prisma.inboxThread.findFirst({
    where: { organizationId: orgId, leadId, channel },
    orderBy: { lastMessageAt: "desc" },
  });
  if (existing) return existing;
  return prisma.inboxThread.create({
    data: { organizationId: orgId, leadId, channel, subject: subject ?? null },
  });
}

/**
 * Record an inbound message. Returns `recorded: false` for a duplicate we have
 * already stored, so this is safe to call on every poll.
 */
export async function recordInbound(orgId: string, input: InboundInput): Promise<InboundResult> {
  const channel: Channel = input.channel ?? "email";

  // Dedupe by provider message id within the org.
  if (input.providerMessageId) {
    const dup = await prisma.inboxMessage.findFirst({
      where: { organizationId: orgId, providerMessageId: input.providerMessageId },
    });
    if (dup) return { recorded: false, matched: !!dup.threadId, matchKind: dup.matchKind as MatchKind };
  }

  // Every id this mail points at: the immediate parent plus the whole chain.
  // Clients keep varying amounts of References, so matching on any of them is
  // what keeps this working past the first exchange.
  const referencedIds = [...new Set([...parseMessageIds(input.inReplyTo), ...parseMessageIds(input.references)])];

  const sent = await matchSentMessage(orgId, referencedIds);
  const knownThread = sent ? null : await matchKnownThread(orgId, referencedIds);

  let matchKind: MatchKind = "none";
  let leadId: string | null = null;
  let threadId: string | null = null;

  if (sent) {
    matchKind = "header";
    leadId = sent.leadId;
  } else if (knownThread) {
    matchKind = "thread";
    threadId = knownThread.threadId;
    leadId = (await prisma.inboxThread.findUnique({ where: { id: knownThread.threadId }, select: { leadId: true } }))?.leadId ?? null;
  } else {
    const lead = await matchLeadByAddress(orgId, input.fromAddr);
    if (lead) {
      matchKind = "address";
      leadId = lead.id;
    }
  }

  // Resolve the thread. A header or address match hangs off the lead's thread;
  // an unknown sender gets a thread of its own so nothing is silently dropped.
  const thread = threadId
    ? await prisma.inboxThread.findUnique({ where: { id: threadId } })
    : leadId
      ? await threadForLead(orgId, leadId, channel, input.subject)
      : await prisma.inboxThread.create({
          data: { organizationId: orgId, channel, subject: input.subject ?? null },
        });
  if (!thread) return { recorded: false, matched: false, matchKind: "none" };

  await prisma.inboxMessage.create({
    data: {
      organizationId: orgId,
      threadId: thread.id,
      direction: "inbound",
      fromAddr: input.fromAddr,
      toAddr: input.toAddr,
      subject: input.subject,
      body: input.body,
      providerMessageId: input.providerMessageId,
      rfcMessageId: input.rfcMessageId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      references: parseMessageIds(input.references),
      matchKind,
      sentAt: input.sentAt ?? new Date(),
    },
  });

  await prisma.inboxThread.update({
    where: { id: thread.id },
    data: { status: "unread", lastMessageAt: input.sentAt ?? new Date() },
  });

  if (leadId) {
    const verified = isVerifiedReply(matchKind);

    // `replied` is the type lib/campaign-engine.ts halts on, so only a verified
    // reply may use it. Everything else is logged as plain inbound — visible in
    // the timeline and the inbox, but it does not stop a sequence.
    await logActivity({
      organizationId: orgId,
      leadId,
      type: verified ? "replied" : "inbound",
      channel,
      // Attribution, finally: without these the per-campaign reply count in
      // lib/reports.ts was structurally always zero.
      campaignId: sent?.campaignId ?? undefined,
      messageId: sent?.id ?? undefined,
      meta: { subject: input.subject, matchKind },
    });

    if (verified) {
      await prisma.lead.update({ where: { id: leadId }, data: { stage: "replied" } });
    }

    const intent = await classifyReplyIntent(input.body ?? input.subject ?? "").catch(() => null);
    await recordConversationEvent({
      organizationId: orgId,
      leadId,
      channel,
      direction: "inbound",
      subject: input.subject ?? null,
      body: input.body ?? null,
      externalId: input.providerMessageId ?? null,
      occurredAt: input.sentAt,
      meta: { ...(intent ? { intent } : {}), matchKind },
    });

    await recomputeAndSaveLeadScore(leadId, orgId).catch(() => {});
  }

  return {
    recorded: true,
    matched: !!leadId,
    matchKind,
    repliedToMessageId: sent?.id,
    campaignId: sent?.campaignId ?? undefined,
  };
}

/** Record an outbound message onto the lead's thread (keeps conversations complete). */
export async function recordOutbound(
  orgId: string,
  input: {
    leadId: string;
    toAddr?: string;
    fromAddr?: string;
    subject?: string;
    body?: string;
    providerMessageId?: string;
    rfcMessageId?: string | null;
    channel?: Channel;
  }
) {
  const channel: Channel = input.channel ?? "email";
  const thread = await threadForLead(orgId, input.leadId, channel, input.subject);
  await prisma.inboxMessage.create({
    data: {
      organizationId: orgId,
      threadId: thread.id,
      direction: "outbound",
      fromAddr: input.fromAddr,
      toAddr: input.toAddr,
      subject: input.subject,
      body: input.body,
      providerMessageId: input.providerMessageId,
      // Storing it here too is what lets case 2 (thread continuation) match a
      // reply to a message that is on the thread but not a campaign send.
      rfcMessageId: input.rfcMessageId ?? null,
      matchKind: "none",
    },
  });
  await prisma.inboxThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } });
  return thread;
}
