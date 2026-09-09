import { prisma } from "./db";
import { safeSend, channels } from "./channels";
import { renderMessage } from "./templates";
import { logActivity } from "./crm";
import { recordOutbound } from "./inbox/store";
import { injectTracking } from "./tracking";
import { senderNameForCampaign, senderNameForAccount } from "./sender";
import { randomUUID } from "node:crypto";
import { buildRfcMessageId, domainOfAddress } from "./inbox/threading";
import type { SendJob } from "./queue";

/**
 * Shared job processor.
 * Performs the actual send, updates message status in Postgres, and logs the CRM activity.
 */
export async function processSendJob(jobData: SendJob) {
  const { organizationId, channel, leadId, campaignId, templateId, templateVersionId, account, nodeId, linkedinAction } =
    jobData;

  // Scope the lead to the job's organization — never send to another tenant's lead.
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) {
    throw new Error(`[job-processor] lead ${leadId} not found in org ${organizationId}`);
  }

  // Version first, live copy second. A step pinned to a snapshot keeps sending
  // the wording it was built with even after someone edits the template; an
  // unpinned step behaves exactly as it always did. The org scope is on the
  // parent template, so a pinned id from another tenant resolves to nothing.
  const tpl = templateId
    ? templateVersionId
      ? await prisma.templateVersion
          .findFirst({
            where: { id: templateVersionId, templateId, template: { organizationId } },
            select: { subject: true, body: true, variables: true },
          })
          .then((v) => v ?? prisma.template.findFirst({ where: { id: templateId, organizationId } }))
      : await prisma.template.findFirst({ where: { id: templateId, organizationId } })
    : null;

  // The sending account's own name (the identity email's From header already shows)
  // wins over the campaign creator's, so every channel this job touches signs consistently.
  const senderName =
    (await senderNameForAccount(account)) || (await senderNameForCampaign(campaignId, organizationId));
  const rendered = tpl
    ? renderMessage(tpl, lead, { senderName })
    : { body: "", subject: undefined };

  // Pre-generate the Message id so open/click tracking can key on it before
  // sending — and so the RFC Message-ID below can be derived from it rather than
  // being a second identifier to keep in step.
  const messageId = randomUUID();

  // The Message-ID header goes out under the sending mailbox's own domain;
  // receiving servers treat a header from an unrelated domain as suspect.
  const sendingDomain = account
    ? domainOfAddress(
        (await prisma.sendingAccount.findFirst({ where: { id: account, organizationId }, select: { email: true } }))?.email
      )
    : null;
  const rfcMessageId =
    channel === "email" ? buildRfcMessageId(messageId, sendingDomain ?? "followthroo.com") : undefined;
  const outbound =
    channel === "email" && rendered.body
      ? { subject: rendered.subject, body: injectTracking(rendered.body, messageId) }
      : rendered;

  const result = await safeSend(
    channel,
    {
      id: lead.id,
      email: lead.email,
      phone: lead.phone,
      linkedinUrl: lead.linkedinUrl,
      firstName: lead.firstName,
    },
    outbound,
    account,
    organizationId,
    rfcMessageId,
    // Which campaign and which LinkedIn gesture. Without this the queue could
    // not tell an invite from a message, or apply a campaign's own caps.
    { campaignId, nodeId, linkedinAction }
  );

  // Whether delivery happens on our servers or in a person's browser. LinkedIn
  // says `humanAssisted: true`, which is what stops a queued action being
  // recorded as a completed send.
  const humanAssisted = channels[channel].capabilities?.().humanAssisted === true;

  await prisma.message.create({
    data: {
      id: messageId,
      organizationId,
      leadId: lead.id,
      campaignId,
      channel,
      templateId,
      renderedSubject: rendered.subject,
      renderedBody: rendered.body, // store the clean body, not the tracked one
      // "ok" from a human-assisted channel means "queued for a person to send",
      // not "delivered". LinkedIn wrote `sent` here AND a second `sent` Message
      // from completeAction once the human confirmed, so every LinkedIn step was
      // counted twice in reports. The adapter already declares
      // `humanAssisted: true`; read it rather than special-casing the name.
      status: result.ok ? (humanAssisted ? "queued" : "sent") : result.skipped ? "queued" : "failed",
      providerId: result.providerId,
      // What actually went on the wire — the poller matches inbound
      // In-Reply-To/References against this.
      rfcMessageId: result.rfcMessageId ?? rfcMessageId ?? null,
      idempotencyKey: randomUUID(),
      sentAt: result.ok && !humanAssisted ? new Date() : null,
    },
  });

  await logActivity({
    organizationId,
    leadId: lead.id,
    campaignId,
    messageId,
    type: result.ok ? "sent" : "failed",
    channel,
    meta: { reason: result.reason, error: result.error },
  });

  // Record the outbound message on the lead's inbox thread so replies thread cleanly.
  if (result.ok && channel === "email" && lead.email) {
    await recordOutbound(organizationId, {
      leadId: lead.id,
      toAddr: lead.email,
      subject: rendered.subject,
      body: rendered.body,
      providerMessageId: result.providerId,
      rfcMessageId: result.rfcMessageId ?? rfcMessageId ?? null,
      channel: "email",
    }).catch((e) => console.error("[job-processor] recordOutbound failed:", e));
  }

  // If rate-limited, return a failure indicator so callers can retry (BullMQ or QStash)
  if (!result.ok && result.reason?.startsWith("rate-limited")) {
    throw new Error(result.reason);
  }

  return result;
}
