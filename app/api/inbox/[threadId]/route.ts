import { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, type TenantContext } from "@/lib/tenant";
import { safeSend } from "@/lib/channels";
import { recordOutbound } from "@/lib/inbox/store";
import { buildRfcMessageId, domainOfAddress } from "@/lib/inbox/threading";
import { logActivity } from "@/lib/crm";
import { leadScope } from "@/lib/scope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ threadId: string }> };

/**
 * Threads this caller may open: the Inbox list's own rule, applied to a single
 * thread. The list was scoped to the caller's contacts while this route checked
 * only the workspace, so a colleague's conversation opened fine from a guessed id.
 */
async function visibleThread(ctx: TenantContext, threadId: string): Promise<Prisma.InboxThreadWhereInput> {
  const scope = await leadScope(ctx);
  return scope.userIds === null
    ? { id: threadId, organizationId: ctx.orgId }
    : { id: threadId, organizationId: ctx.orgId, lead: scope.where };
}

/**
 * GET a thread with its full message history — and where each message came from.
 *
 * "Which campaign is this a reply to?" was answerable all along (lib/inbox/store.ts
 * matched it) and shown nowhere. Each message now carries the campaign that sent
 * it, or the one it answers, and a manual reply names who typed it.
 *
 * WhatsApp and LinkedIn replies carry no headers to match, so for those the thread
 * says which campaign last contacted the person — worded as exactly that, never as
 * "a reply to", because nothing proves it is one.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { threadId } = await params;
  const thread = await prisma.inboxThread.findFirst({
    where: await visibleThread(ctx, threadId),
    include: { lead: true, messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!thread) return fail("not found", 404);

  const lastCampaignSend =
    thread.leadId && thread.channel !== "email"
      ? await prisma.message.findFirst({
          where: {
            organizationId: ctx.orgId,
            leadId: thread.leadId,
            channel: thread.channel,
            campaignId: { not: null },
            status: { in: ["sent", "delivered", "replied"] },
          },
          orderBy: { createdAt: "desc" },
          select: { campaignId: true, sentAt: true, createdAt: true },
        })
      : null;

  const campaignIds = [
    ...new Set([...thread.messages.map((m) => m.campaignId), lastCampaignSend?.campaignId].filter((v): v is string => !!v)),
  ];
  const userIds = [...new Set(thread.messages.map((m) => m.sentByUserId).filter((v): v is string => !!v))];
  const [campaigns, users] = await Promise.all([
    campaignIds.length
      ? prisma.campaign.findMany({
          where: { id: { in: campaignIds }, organizationId: ctx.orgId },
          select: { id: true, name: true, archivedAt: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  const campaignName = new Map(campaigns.map((c) => [c.id, c.archivedAt ? `${c.name} (deleted)` : c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]));

  return ok({
    ...thread,
    messages: thread.messages.map((m) => ({
      ...m,
      campaignName: m.campaignId ? (campaignName.get(m.campaignId) ?? null) : null,
      sentByName: m.sentByUserId ? (userName.get(m.sentByUserId) ?? null) : null,
    })),
    lastContactedBy: lastCampaignSend?.campaignId
      ? {
          campaignName: campaignName.get(lastCampaignSend.campaignId) ?? null,
          at: lastCampaignSend.sentAt ?? lastCampaignSend.createdAt,
        }
      : null,
  });
}

const Patch = z.object({ status: z.enum(["unread", "read", "interested", "not_interested", "ooo"]) });

// PATCH status (triage: read / interested / not interested / OOO).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { threadId } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid status");
  const res = await prisma.inboxThread.updateMany({
    where: await visibleThread(ctx, threadId),
    data: { status: parsed.data.status },
  });
  if (res.count === 0) return fail("not found", 404);
  return ok({ status: parsed.data.status });
}

const Reply = z.object({ body: z.string().min(1), subject: z.string().optional() });

/**
 * POST a reply — sends an email to the lead and records it on the thread.
 *
 * It is also recorded as a Message now. A reply typed here was an email that
 * existed only as a line on the thread: missing from the Outbox, from the lead's
 * send history, and from every count of what went out.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { threadId } = await params;
  const parsed = Reply.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("expected { body, subject? }");

  const thread = await prisma.inboxThread.findFirst({
    where: await visibleThread(ctx, threadId),
    include: { lead: true },
  });
  if (!thread) return fail("not found", 404);
  if (!thread.lead?.email) return fail("thread has no lead email to reply to", 400);

  // The workspace's own mailbox. No platform fallback: replying from Followthroo's
  // address would strand the contact's answer in an inbox nobody polls.
  const account = await prisma.sendingAccount.findFirst({
    where: { organizationId: ctx.orgId, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });

  const subject = parsed.data.subject ?? (thread.subject ? `Re: ${thread.subject}` : "Re:");
  // Stamped like a campaign send, so an answer to this reply threads back to it.
  const messageId = randomUUID();
  const rfcMessageId = buildRfcMessageId(messageId, domainOfAddress(account?.email) ?? "followthroo.com");
  const result = await safeSend(
    "email",
    { id: thread.lead.id, email: thread.lead.email, firstName: thread.lead.firstName },
    { subject, body: parsed.data.body },
    account?.id,
    ctx.orgId,
    rfcMessageId,
    // Typed by a person, answering someone who wrote in: that's the inbox, which is free.
    { free: true }
  );

  if (!result.ok) return fail(result.reason || result.error || "send failed", 400);

  await prisma.message.create({
    data: {
      id: messageId,
      organizationId: ctx.orgId,
      leadId: thread.lead.id,
      channel: "email",
      renderedSubject: subject,
      renderedBody: parsed.data.body,
      status: "sent",
      providerId: result.providerId,
      rfcMessageId: result.rfcMessageId ?? rfcMessageId,
      idempotencyKey: randomUUID(),
      sentAt: new Date(),
      kind: "message",
      sentByUserId: ctx.userId,
    },
  });
  await logActivity({
    organizationId: ctx.orgId,
    leadId: thread.lead.id,
    messageId,
    type: "sent",
    channel: "email",
    meta: { manual: true },
  });

  await recordOutbound(ctx.orgId, {
    leadId: thread.lead.id,
    toAddr: thread.lead.email,
    subject,
    body: parsed.data.body,
    providerMessageId: result.providerId,
    rfcMessageId: result.rfcMessageId ?? rfcMessageId,
    channel: "email",
    sentByUserId: ctx.userId,
  });
  await prisma.inboxThread.update({ where: { id: thread.id }, data: { status: "read" } });

  return ok({ sent: true });
}
