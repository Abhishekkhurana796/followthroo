import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";
import { CampaignSequence, validateSequence } from "@/lib/campaign-engine";
import { CAMPAIGN_INCLUDE } from "@/lib/queries";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/campaigns/[id] — fetch a single campaign */
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.orgId },
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

  // Verify ownership
  const existing = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.orgId },
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
        where: { id: parsed.data.sendingAccountId, organizationId: ctx.orgId },
        select: { id: true },
      });
      if (!owned) return fail("Sending account not found", 404);
      data.sendingAccount = { connect: { id: owned.id } };
    } else {
      data.sendingAccount = { disconnect: true };
    }
  }

  const updated = await prisma.campaign.update({ where: { id }, data });
  return ok(updated);
}

/** DELETE /api/campaigns/[id] */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;
  const { id } = await params;

  const existing = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.orgId },
  });
  if (!existing) return fail("Campaign not found", 404);

  await prisma.campaign.delete({ where: { id } });
  return ok({ deleted: true });
}
