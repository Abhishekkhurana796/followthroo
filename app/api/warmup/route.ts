import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { canUseSendingAccountWhere } from "@/lib/sending-account-access";

export const runtime = "nodejs";

// PATCH /api/warmup — enable/disable + configure warm-up for a sending account.
const Body = z.object({
  sendingAccountId: z.string(),
  enabled: z.boolean().optional(),
  dailyTarget: z.number().int().min(1).max(50).optional(),
  rampDays: z.number().int().min(0).max(90).optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  // A teammate may only configure warm-up for the mailbox they connected.
  const account = await prisma.sendingAccount.findFirst({
    where: canUseSendingAccountWhere(ctx, parsed.data.sendingAccountId),
  });
  if (!account) return fail("You can only configure a mailbox you connected.", 403);

  const { sendingAccountId, ...cfg } = parsed.data;
  const warmup = await prisma.warmup.upsert({
    where: { sendingAccountId },
    create: { organizationId: ctx.orgId, sendingAccountId, ...cfg },
    update: cfg,
  });
  return ok(warmup);
}
