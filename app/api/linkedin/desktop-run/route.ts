import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { acquireDesktopRun, currentDesktopRun, releaseDesktopRun, renewDesktopRun } from "@/lib/linkedin/desktop-run";
import { fail, ok } from "@/lib/http";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";

export const runtime = "nodejs";
export function OPTIONS() { return corsPreflight(); }
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acquire"), runId: z.string().uuid(), deviceId: z.string().min(8).max(100), campaignId: z.string().nullable() }),
  z.object({ action: z.literal("heartbeat"), runId: z.string().uuid() }),
  z.object({ action: z.literal("release"), runId: z.string().uuid() }),
]);

export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);
  return withCors(ok({ run: await currentDesktopRun(account.id) }));
}

export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail("invalid desktop run request"));
  if (parsed.data.action === "acquire") {
    if (parsed.data.campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: parsed.data.campaignId, organizationId: account.organizationId, archivedAt: null }, select: { id: true } });
      if (!campaign) return withCors(fail("campaign not found", 404));
    }
    const result = await acquireDesktopRun(account.id, { runId: parsed.data.runId, deviceId: parsed.data.deviceId, campaignId: parsed.data.campaignId, startedAt: new Date().toISOString() });
    if (!result.ok && result.unavailable) return withCors(fail("Safe desktop locking is unavailable. Configure Redis before starting LinkedIn automation.", 503));
    if (!result.ok) return withCors(fail("This LinkedIn account is already running on another desktop.", 409));
    return withCors(ok(result));
  }
  if (parsed.data.action === "heartbeat") {
    if (!(await renewDesktopRun(account.id, parsed.data.runId))) return withCors(fail("This desktop no longer owns the LinkedIn run.", 409));
    return withCors(ok({ renewed: true }));
  }
  return withCors(ok({ released: await releaseDesktopRun(account.id, parsed.data.runId) }));
}
