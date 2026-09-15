import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { effectiveInviteCap, queueStats } from "@/lib/linkedin/queue";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

// GET /api/linkedin/config (Bearer extToken) — config + the org's campaigns & groups for the
// extension's Options page.
export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const [campaigns, groups, queue] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: account.organizationId, archivedAt: null },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.segment.findMany({
      where: { organizationId: account.organizationId },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    queueStats(account.organizationId),
  ]);

  return withCors(
    ok({
      status: account.status,
      liMemberName: account.liMemberName,
      lastSeenAt: account.lastSeenAt,
      dailyInviteCap: effectiveInviteCap(account),
      minDelaySec: account.minDelaySec,
      maxDelaySec: account.maxDelaySec,
      mode: account.mode,
      // Read-only here on purpose. The desktop app shows this so someone can
      // see why a run refused to start, but the switch itself stays in the web
      // app behind its confirmation — a client that could turn on automatic
      // sending for itself is a client that can arm the risky mode without the
      // person who owns the account ever seeing the warning.
      autoSend: account.autoSend,
      selectedCampaignIds: account.selectedCampaignIds,
      campaignSettings: account.campaignSettings,
      queue,
      campaigns,
      groups,
    })
  );
}

const PerCampaign = z.object({
  cap: z.number().int().min(1).max(100).optional(),
  minDelaySec: z.number().int().min(10).max(900).optional(),
  maxDelaySec: z.number().int().min(15).max(1200).optional(),
  mode: z.enum(["auto", "invite", "message"]).optional(),
  enabled: z.boolean().optional(),
});

const Body = z.object({
  selectedCampaignIds: z.array(z.string()).optional(),
  mode: z.enum(["auto", "invite", "message"]).optional(),
  dailyInviteCap: z.number().int().min(1).max(20).optional(),
  minDelaySec: z.number().int().min(10).max(900).optional(),
  maxDelaySec: z.number().int().min(15).max(1200).optional(),
  campaignSettings: z.record(z.string(), PerCampaign).optional(),
});

// PUT /api/linkedin/config (Bearer extToken) — save the config.
export async function PUT(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail(parsed.error.issues[0]?.message ?? "invalid body"));

  const d = parsed.data;
  const data: Prisma.LinkedInAccountUpdateInput = {};
  if (d.selectedCampaignIds !== undefined) data.selectedCampaignIds = d.selectedCampaignIds;
  if (d.mode !== undefined) data.mode = d.mode;
  if (d.dailyInviteCap !== undefined) data.dailyInviteCap = d.dailyInviteCap;
  if (d.minDelaySec !== undefined) data.minDelaySec = d.minDelaySec;
  if (d.maxDelaySec !== undefined) data.maxDelaySec = d.maxDelaySec;
  if (d.campaignSettings !== undefined) data.campaignSettings = d.campaignSettings as Prisma.InputJsonValue;

  const updated = await prisma.linkedInAccount.update({ where: { id: account.id }, data });
  return withCors(
    ok({
      mode: updated.mode,
      selectedCampaignIds: updated.selectedCampaignIds,
      dailyInviteCap: effectiveInviteCap(updated),
      minDelaySec: updated.minDelaySec,
      maxDelaySec: updated.maxDelaySec,
      campaignSettings: updated.campaignSettings,
    })
  );
}
