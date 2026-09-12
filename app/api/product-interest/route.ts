import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";

export const runtime = "nodejs";

const Body = z.object({ feature: z.literal("instagram_posts") });

/** POST /api/product-interest — "Notify me" on a coming-soon feature. Idempotent per person per feature. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid body");
  await prisma.productInterest.upsert({
    where: { organizationId_userId_feature: { organizationId: ctx.orgId, userId: ctx.userId, feature: parsed.data.feature } },
    create: { organizationId: ctx.orgId, userId: ctx.userId, feature: parsed.data.feature },
    update: {},
  });
  return ok({ registered: true });
}

export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const feature = req.nextUrl.searchParams.get("feature") ?? "instagram_posts";
  const existing = await prisma.productInterest.findUnique({
    where: { organizationId_userId_feature: { organizationId: ctx.orgId, userId: ctx.userId, feature } },
  });
  return ok({ registered: !!existing });
}
