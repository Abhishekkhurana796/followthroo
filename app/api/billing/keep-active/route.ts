import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";
import { workspacePlan } from "@/lib/billing/subscription";

export const runtime = "nodejs";

/**
 * "Choose what stays active."
 *
 * When a workspace has more running than its plan includes — after a downgrade,
 * or when a trial ends — its owners and admins pick which campaigns, sending
 * inboxes and people stay on. Nothing is deleted. Campaigns left out pause where
 * each lead is up to; inboxes stop sending and keep receiving replies; people go
 * read-only. Upgrading, or choosing again, turns them back on.
 */

/** GET — what's on now, and the plan's limits, for the dialog. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const [wp, campaigns, inboxes, members] = await Promise.all([
    workspacePlan(ctx.orgId),
    prisma.campaign.findMany({
      where: { organizationId: ctx.orgId, archivedAt: null },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    // Chosen fields only: a SendingAccount row carries credentials.
    prisma.sendingAccount.findMany({
      where: { organizationId: ctx.orgId },
      select: { id: true, email: true, provider: true, active: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.member.findMany({
      where: { organizationId: ctx.orgId },
      select: { id: true, role: true, seatActive: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return ok({
    plan: wp.plan ? { id: wp.plan.id, name: wp.plan.name } : null,
    limits: wp.plan
      ? { campaigns: wp.plan.limits.campaigns, inboxes: wp.plan.limits.inboxes, users: wp.plan.limits.users }
      : { campaigns: 0, inboxes: 0, users: 0 },
    campaigns,
    inboxes,
    people: members.map((m) => ({
      id: m.id,
      role: m.role,
      active: m.seatActive !== false,
      name: m.user.name || m.user.email,
      email: m.user.email,
    })),
  });
}

const Keep = z.object({
  campaignIds: z.array(z.string()).max(1000),
  inboxIds: z.array(z.string()).max(200),
  memberIds: z.array(z.string()).max(200),
});

/** POST — keep these on; pause, stop or make read-only the rest. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;

  const parsed = Keep.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Say which campaigns, inboxes and people stay active.", 422);

  const wp = await workspacePlan(ctx.orgId);
  if (!wp.plan) return fail("Choose a plan first, then pick what stays active on it.", 402);
  const { limits, name } = wp.plan;

  // The owner always keeps a seat: somebody has to be able to change the plan.
  const owner = await prisma.member.findFirst({ where: { organizationId: ctx.orgId, role: "owner" }, select: { id: true } });
  const keepMembers = [...new Set([...parsed.data.memberIds, ...(owner ? [owner.id] : [])])];
  const keepCampaigns = [...new Set(parsed.data.campaignIds)];
  const keepInboxes = [...new Set(parsed.data.inboxIds)];

  const [runningKept, inboxesKept, peopleKept] = await Promise.all([
    prisma.campaign.count({ where: { organizationId: ctx.orgId, archivedAt: null, status: "active", id: { in: keepCampaigns } } }),
    prisma.sendingAccount.count({ where: { organizationId: ctx.orgId, id: { in: keepInboxes } } }),
    prisma.member.count({ where: { organizationId: ctx.orgId, id: { in: keepMembers } } }),
  ]);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (runningKept > limits.campaigns) return fail(`${name} runs ${plural(limits.campaigns, "campaign", "campaigns")} at once. Pick fewer.`, 422);
  if (inboxesKept > limits.inboxes) return fail(`${name} includes ${plural(limits.inboxes, "sending inbox", "sending inboxes")}. Pick fewer.`, 422);
  if (peopleKept > limits.users) return fail(`${name} includes ${plural(limits.users, "person", "people")}, the owner among them. Pick fewer.`, 422);

  const [paused, stopped, readOnly] = await prisma.$transaction([
    // Only running campaigns are paused; one somebody paused on purpose is left as it is.
    prisma.campaign.updateMany({
      where: { organizationId: ctx.orgId, archivedAt: null, status: "active", id: { notIn: keepCampaigns } },
      data: { status: "paused" },
    }),
    prisma.sendingAccount.updateMany({
      where: { organizationId: ctx.orgId, active: true, id: { notIn: keepInboxes } },
      data: { active: false },
    }),
    prisma.member.updateMany({
      where: { organizationId: ctx.orgId, id: { notIn: keepMembers } },
      data: { seatActive: false },
    }),
    prisma.sendingAccount.updateMany({ where: { organizationId: ctx.orgId, id: { in: keepInboxes } }, data: { active: true } }),
    prisma.member.updateMany({ where: { organizationId: ctx.orgId, id: { in: keepMembers } }, data: { seatActive: null } }),
  ]);

  return ok({ paused: paused.count, inboxesStopped: stopped.count, readOnly: readOnly.count });
}
