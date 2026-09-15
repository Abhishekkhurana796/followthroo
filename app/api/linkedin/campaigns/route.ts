import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { currentDesktopRun } from "@/lib/linkedin/desktop-run";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";

export const runtime = "nodejs";
export function OPTIONS() { return corsPreflight(); }

type CampaignSetting = { enabled?: boolean; executionState?: "ready" | "paused" | "stopped" };

function containsLinkedIn(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsLinkedIn);
  const object = value as Record<string, unknown>;
  return object.channel === "linkedin" || Object.values(object).some(containsLinkedIn);
}

export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);
  await prisma.linkedInAccount.update({ where: { id: account.id }, data: { lastSeenAt: new Date(), status: "connected" } });

  const [campaigns, grouped, missingMessages, run, activeEnrollments] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: account.organizationId, archivedAt: null },
      select: { id: true, name: true, status: true, sequence: true, _count: { select: { enrollments: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.linkedInAction.groupBy({
      by: ["campaignId", "status"],
      where: { organizationId: account.organizationId, campaignId: { not: null } },
      _count: { _all: true },
    }),
    prisma.linkedInAction.groupBy({
      by: ["campaignId"],
      where: { organizationId: account.organizationId, campaignId: { not: null }, type: "message", status: "pending", note: null },
      _count: { _all: true },
    }),
    currentDesktopRun(account.id),
    prisma.enrollment.groupBy({
      by: ["campaignId"],
      where: { organizationId: account.organizationId, status: "active" },
      _count: { _all: true },
    }),
  ]);
  const settings = (account.campaignSettings ?? {}) as Record<string, CampaignSetting>;
  const counts = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    if (!row.campaignId) continue;
    const current = counts.get(row.campaignId) ?? {};
    current[row.status] = row._count._all;
    counts.set(row.campaignId, current);
  }
  const missing = new Map(missingMessages.flatMap((row) => row.campaignId ? [[row.campaignId, row._count._all] as const] : []));
  const stillEnrolled = new Map(activeEnrollments.map((row) => [row.campaignId, row._count._all]));
  return withCors(ok({
    connected: true,
    activeRun: run,
    campaigns: campaigns.filter((campaign) => containsLinkedIn(campaign.sequence)).map((campaign) => {
      const byStatus = counts.get(campaign.id) ?? {};
      const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
      const completed = (byStatus.sent ?? 0) + (byStatus.failed ?? 0) + (byStatus.skipped ?? 0);
      const queued = (byStatus.pending ?? 0) + (byStatus.in_progress ?? 0) + (byStatus.drafted ?? 0);
      // "Completed" needs more than an empty queue: a sequence of invite → wait
      // 3 days → message has nothing queued for those three days while every
      // lead is still mid-sequence. Only once no enrollment is still moving is
      // there genuinely nothing left for LinkedIn to do.
      const saved = settings[campaign.id]?.executionState;
      const executionState = run?.campaignId === campaign.id
        ? "running"
        : saved === "paused" || saved === "stopped"
          ? saved
          : total > 0 && queued === 0 && !stillEnrolled.get(campaign.id)
            ? "completed"
            : "ready";
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        leads: campaign._count.enrollments,
        total,
        completed,
        queued,
        ready: byStatus.pending ?? 0,
        sent: byStatus.sent ?? 0,
        failed: byStatus.failed ?? 0,
        missingMessages: missing.get(campaign.id) ?? 0,
        executionState,
      };
    }),
  }));
}

const Control = z.object({ campaignId: z.string(), action: z.enum(["pause", "resume", "stop"]) });

export async function PATCH(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);
  const parsed = Control.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail("expected { campaignId, action }"));
  const campaign = await prisma.campaign.findFirst({ where: { id: parsed.data.campaignId, organizationId: account.organizationId, archivedAt: null }, select: { id: true } });
  if (!campaign) return withCors(fail("campaign not found", 404));
  const settings = (account.campaignSettings ?? {}) as Record<string, CampaignSetting>;
  const executionState = parsed.data.action === "resume" ? "ready" : parsed.data.action === "stop" ? "stopped" : "paused";
  const next = { ...settings, [campaign.id]: { ...settings[campaign.id], enabled: parsed.data.action === "resume", executionState } };
  await prisma.linkedInAccount.update({ where: { id: account.id }, data: { campaignSettings: next as Prisma.InputJsonValue } });
  return withCors(ok({ campaignId: campaign.id, executionState }));
}
