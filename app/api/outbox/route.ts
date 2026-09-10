import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { leadScope } from "@/lib/scope";

export const runtime = "nodejs";

const PAGE = 50;

const LEAD_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  company: true,
  linkedinUrl: true,
} satisfies Prisma.LeadSelect;

/** What an invitation's row means to a person, in one word. */
function inviteState(a: { status: string; result: string | null; acceptedAt: Date | null }) {
  if (a.acceptedAt) return "accepted";
  switch (a.status) {
    case "sent":
      return "sent";
    case "pending":
    case "in_progress":
      return "queued";
    case "drafted":
      return "waiting"; // filled in on LinkedIn, waiting for a person to press Send
    case "failed":
      return "failed";
    default:
      if (/^already connected/i.test(a.result ?? "")) return "already_connected";
      if (/^campaign deleted/i.test(a.result ?? "")) return "cancelled";
      return "skipped";
  }
}

/** Campaign and member names for a page of rows, in two queries. */
async function names(orgId: string, campaignIds: (string | null)[], userIds: (string | null)[]) {
  const cids = [...new Set(campaignIds.filter((v): v is string => !!v))];
  const uids = [...new Set(userIds.filter((v): v is string => !!v))];
  const [campaigns, users] = await Promise.all([
    cids.length
      ? prisma.campaign.findMany({
          where: { id: { in: cids }, organizationId: orgId },
          select: { id: true, name: true, archivedAt: true },
        })
      : Promise.resolve([]),
    uids.length
      ? prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  return {
    campaign: new Map(campaigns.map((c) => [c.id, c.archivedAt ? `${c.name} (deleted)` : c.name])),
    user: new Map(users.map((u) => [u.id, u.name || u.email])),
  };
}

/**
 * GET /api/outbox?tab=messages|invites&channel=&campaignId=&status=&cursor=
 *
 * What went out, and what sent it.
 *
 *   messages — every email, WhatsApp and LinkedIn message actually sent (or that
 *              failed trying), with the campaign behind it, or the member who
 *              typed it, or the AI agent.
 *   invites  — every LinkedIn connection request, from queued to accepted.
 *
 * Invitations are a tab of their own rather than rows among the messages: a
 * connection request is not something a person can reply to, and its real
 * outcome — accepted or not — arrives days later.
 *
 * Scoped like the Leads screen, so a member sees what went to their own contacts.
 * Newest first, paged by cursor: this list only ever grows.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const sp = req.nextUrl.searchParams;
  const tab = sp.get("tab") === "invites" ? "invites" : "messages";
  const campaignId = sp.get("campaignId") || undefined;
  const cursor = sp.get("cursor") || undefined;
  const { where: leadWhere } = await leadScope(ctx);
  // "none" filters to sends that no campaign made.
  const campaignFilter = campaignId ? { campaignId: campaignId === "none" ? null : campaignId } : {};

  if (tab === "messages") {
    const channel = sp.get("channel");
    const rows = await prisma.message.findMany({
      where: {
        organizationId: ctx.orgId,
        kind: "message",
        // Sent, or tried and failed. Queued rows are steps that have not happened,
        // and drafts are the agent's proposals waiting for approval.
        status: { in: ["sent", "delivered", "bounced", "replied", "failed"] },
        lead: leadWhere,
        ...(channel === "email" || channel === "whatsapp" || channel === "linkedin" ? { channel } : {}),
        ...campaignFilter,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        channel: true,
        status: true,
        renderedSubject: true,
        renderedBody: true,
        sentAt: true,
        createdAt: true,
        campaignId: true,
        sentByUserId: true,
        lead: { select: LEAD_SELECT },
      },
    });
    const page = rows.slice(0, PAGE);
    const n = await names(ctx.orgId, page.map((r) => r.campaignId), page.map((r) => r.sentByUserId));

    return ok({
      items: page.map((r) => ({
        id: r.id,
        channel: r.channel,
        status: r.status,
        subject: r.renderedSubject,
        preview: (r.renderedBody ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160),
        at: r.sentAt ?? r.createdAt,
        campaign: r.campaignId ? { id: r.campaignId, name: n.campaign.get(r.campaignId) ?? "Deleted campaign" } : null,
        // Neither a campaign nor a person: the agent sent it.
        sentBy: r.sentByUserId ? (n.user.get(r.sentByUserId) ?? "A former member") : r.campaignId ? null : "AI agent",
        lead: r.lead,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    });
  }

  const status = sp.get("status");
  const statusFilter: Prisma.LinkedInActionWhereInput =
    status === "accepted"
      ? { acceptedAt: { not: null } }
      : status === "queued"
        ? { status: { in: ["pending", "in_progress", "drafted"] } }
        : status === "sent"
          ? { status: "sent", acceptedAt: null }
          : status === "failed"
            ? { status: "failed" }
            : {};

  const rows = await prisma.linkedInAction.findMany({
    where: {
      AND: [
        { organizationId: ctx.orgId, lead: leadWhere, ...campaignFilter },
        // Rows from before `kind` existed read as the desktop app treated them.
        { OR: [{ kind: "invite" }, { kind: null, type: { not: "message" } }] },
        statusFilter,
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      result: true,
      note: true,
      sentAt: true,
      acceptedAt: true,
      createdAt: true,
      campaignId: true,
      lead: { select: LEAD_SELECT },
    },
  });
  const page = rows.slice(0, PAGE);
  const n = await names(ctx.orgId, page.map((r) => r.campaignId), []);

  return ok({
    items: page.map((r) => ({
      id: r.id,
      state: inviteState(r),
      note: r.note,
      result: r.result,
      queuedAt: r.createdAt,
      sentAt: r.sentAt,
      acceptedAt: r.acceptedAt,
      campaign: r.campaignId ? { id: r.campaignId, name: n.campaign.get(r.campaignId) ?? "Deleted campaign" } : null,
      lead: r.lead,
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
  });
}
