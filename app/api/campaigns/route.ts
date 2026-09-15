import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";
import { CampaignSequence, validateSequence } from "@/lib/campaign-engine";
import { enrollLeads } from "@/lib/enroll";
import { CAMPAIGN_INCLUDE } from "@/lib/queries";
import { requireLimit } from "@/lib/billing/limits";
import { canUseSendingAccountWhere } from "@/lib/sending-account-access";
import type { TenantContext } from "@/lib/tenant";

export const runtime = "nodejs";

const CreateCampaign = z.object({
  name: z.string().min(1),
  // A node graph (see lib/campaign-engine.ts). Accepts a legacy flat step array too.
  sequence: CampaignSequence.default([]),
  sendingAccountId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const campaigns = await prisma.campaign.findMany({
    // Deleted campaigns with history are archived, not removed — see DELETE in ./[id].
    where: { organizationId: ctx.orgId, archivedAt: null },
    include: CAMPAIGN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return ok(campaigns);
}

/** A team member may only attach the mailbox they connected. */
async function canUseSendingAccount(ctx: TenantContext, accountId: string): Promise<boolean> {
  const hit = await prisma.sendingAccount.findFirst({
    where: canUseSendingAccountWhere(ctx, accountId),
    select: { id: true },
  });
  return !!hit;
}

export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;
  const parsed = CreateCampaign.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");
  if (parsed.data.sendingAccountId && !(await canUseSendingAccount(ctx, parsed.data.sendingAccountId))) {
    return fail("You can only send from a mailbox you connected.", 403);
  }
  // Beyond Zod's shape check: a sequence can be well-formed and still impossible
  // to run — a connection note that will exceed LinkedIn's 300 characters once
  // personalised, or a template from another workspace.
  const valid = await validateSequence(ctx.orgId, parsed.data.sequence);
  if (!valid.ok) return fail(valid.message);
  const full = await requireLimit(ctx.orgId, "campaigns");
  if (full) return full;

  const campaign = await prisma.campaign.create({
    data: {
      organizationId: ctx.orgId,
      createdBy: ctx.userId,
      name: parsed.data.name,
      sequence: parsed.data.sequence as unknown as Prisma.InputJsonValue,
      sendingAccountId: parsed.data.sendingAccountId || null,
    },
  });
  return ok(campaign, { status: 201 });
}

// PUT /api/campaigns — launch a campaign to all of an org's leads (kept for the
// existing "Launch" button; targeted enrollment lives at /api/campaigns/[id]/enroll).
const Launch = z.object({ campaignId: z.string(), leadIds: z.array(z.string()).min(1) });

export async function PUT(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Launch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("expected { campaignId, leadIds[] }");

  const result = await enrollLeads(ctx.orgId, parsed.data.campaignId, parsed.data.leadIds);
  if ("error" in result) return fail(result.error, result.status);
  return ok(result);
}
