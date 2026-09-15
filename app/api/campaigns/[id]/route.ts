import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";
import { CampaignSequence, validateSequence } from "@/lib/campaign-engine";
import { CAMPAIGN_INCLUDE } from "@/lib/queries";
import { canUseSendingAccountWhere } from "@/lib/sending-account-access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/campaigns/[id] — fetch a single campaign */
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
    include: CAMPAIGN_INCLUDE,
  });
  if (!campaign) return fail("Campaign not found", 404);
  return ok(campaign);
}

const UpdateCampaign = z.object({
  name: z.string().min(1).optional(),
  sequence: CampaignSequence.optional(),
  sendingAccountId: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "done"]).optional(),
});

/** PATCH /api/campaigns/[id] — update name / sequence / sending account */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;
  const { id } = await params;

  // Verify ownership. A deleted (archived) campaign is gone as far as editing
  // goes — reactivating one would restart sends nobody can see in the list.
  const existing = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!existing) return fail("Campaign not found", 404);

  const parsed = UpdateCampaign.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  const data: Prisma.CampaignUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.sequence !== undefined) {
    // Same guard as create: the builder is not the only writer.
    const valid = await validateSequence(ctx.orgId, parsed.data.sequence);
    if (!valid.ok) return fail(valid.message);
    data.sequence = parsed.data.sequence as unknown as Prisma.InputJsonValue;
  }
  if ("sendingAccountId" in parsed.data) {
    // Scope the connect to this org: `connect: { id }` alone would happily attach
    // another tenant's mailbox and send their customers' mail through it.
    if (parsed.data.sendingAccountId) {
      const owned = await prisma.sendingAccount.findFirst({
        where: canUseSendingAccountWhere(ctx, parsed.data.sendingAccountId),
        select: { id: true },
      });
      if (!owned) return fail("You can only send from a mailbox you connected.", 403);
      data.sendingAccount = { connect: { id: owned.id } };
    } else {
      data.sendingAccount = { disconnect: true };
    }
  }

  const updated = await prisma.campaign.update({ where: { id }, data });
  return ok(updated);
}

/**
 * DELETE /api/campaigns/[id] — stop it, then remove it.
 *
 * This used to be a bare `campaign.delete`. Enrollments cascaded away, but
 * LinkedInAction.campaignId is a plain column with no foreign key, so every
 * invitation the campaign had already queued stayed `pending` — and the desktop
 * app would have claimed and sent them for a campaign that no longer existed.
 * An invitation cannot be recalled.
 *
 * So everything still in flight is stopped first, in one transaction. A campaign
 * that never reached anybody is then deleted outright; one with history is
 * archived instead, so its sends, replies and invitations keep naming it in the
 * Inbox, Outbox and Reports.
 *
 * `?dryRun=1` reports what would happen without doing it, for the confirm dialog.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;
  const { id } = await params;

  const existing = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
    select: { id: true },
  });
  if (!existing) return fail("Campaign not found", 404);

  const inFlight: Prisma.EnrollmentWhereInput = { campaignId: id, status: { in: ["active", "paused"] } };
  const queued: Prisma.LinkedInActionWhereInput = {
    organizationId: ctx.orgId,
    campaignId: id,
    status: { in: ["pending", "in_progress", "drafted"] },
  };

  const [stopping, cancelling, messages, sentActions] = await Promise.all([
    prisma.enrollment.count({ where: inFlight }),
    prisma.linkedInAction.count({ where: queued }),
    prisma.message.count({ where: { organizationId: ctx.orgId, campaignId: id } }),
    prisma.linkedInAction.count({ where: { organizationId: ctx.orgId, campaignId: id, status: "sent" } }),
  ]);
  const keepHistory = messages > 0 || sentActions > 0;

  if (req.nextUrl.searchParams.get("dryRun")) {
    return ok({ stopping, cancelling, archived: keepHistory });
  }

  await prisma.$transaction(async (tx) => {
    await tx.enrollment.updateMany({ where: inFlight, data: { status: "stopped", nextRunAt: null } });
    await tx.linkedInAction.updateMany({ where: queued, data: { status: "skipped", result: "campaign deleted" } });
    if (keepHistory) {
      await tx.campaign.update({ where: { id }, data: { status: "done", archivedAt: new Date() } });
    } else {
      await tx.campaign.delete({ where: { id } });
    }
  });

  return ok({ deleted: true, archived: keepHistory, stopped: stopping, cancelled: cancelling });
}
