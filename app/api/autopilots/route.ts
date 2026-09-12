import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { requireLimit } from "@/lib/billing/limits";
import { requireFeature } from "@/lib/billing/limits";
import { requireModel } from "@/lib/posts/write";
import { scheduleAutopilot } from "@/lib/posts/schedule";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const autopilots = await prisma.autopilot.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" } });
  return ok(autopilots);
}

const Schedule = z.union([
  z.object({ type: z.literal("every_n_days"), n: z.number().int().min(1).max(30), time: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ type: z.literal("weekdays"), days: z.array(z.number().int().min(0).max(6)).min(1), time: z.string().regex(/^\d{2}:\d{2}$/) }),
]);

const Body = z.object({
  platform: z.literal("linkedin").default("linkedin"),
  name: z.string().min(1).max(120),
  query: z.string().min(1).max(200),
  hashtags: z.array(z.string().max(60)).max(10).default([]),
  brief: z.string().max(2000).optional(),
  model: z.string(),
  variants: z.number().int().min(1).max(3).default(1),
  mode: z.enum(["auto", "review"]).default("review"),
  schedule: Schedule,
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).default(330),
  reviewLeadHours: z.number().int().min(1).max(24).default(3),
});

/** POST /api/autopilots — create a standing autopilot. Counts against the plan's autopilot limit. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const limited = await requireLimit(ctx.orgId, "autopilots");
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  let model;
  try {
    model = requireModel(parsed.data.model);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "invalid model", 422);
  }
  if (model.tier === "premium") {
    const locked = await requireFeature(ctx.orgId, "premium_ai_models", "Premium AI models");
    if (locked) return locked;
  }

  const variants = parsed.data.mode === "auto" ? 1 : parsed.data.variants;
  const nextRunAt = scheduleAutopilot({
    schedule: parsed.data.schedule,
    timezoneOffsetMinutes: parsed.data.timezoneOffsetMinutes,
    mode: parsed.data.mode,
    reviewLeadHours: parsed.data.reviewLeadHours,
  });

  const autopilot = await prisma.autopilot.create({
    data: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      platform: parsed.data.platform,
      name: parsed.data.name,
      query: parsed.data.query,
      hashtags: parsed.data.hashtags,
      brief: parsed.data.brief,
      model: model.id,
      variants,
      mode: parsed.data.mode,
      schedule: parsed.data.schedule,
      timezoneOffsetMinutes: parsed.data.timezoneOffsetMinutes,
      reviewLeadHours: parsed.data.reviewLeadHours,
      nextRunAt,
    },
  });
  return ok(autopilot, { status: 201 });
}
