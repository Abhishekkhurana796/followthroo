import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { findTrendingTopics } from "@/lib/posts/research";

export const runtime = "nodejs";
export const maxDuration = 60; // three network sources in parallel, each with its own timeout

const Body = z.object({ query: z.string().min(1).max(200), hashtags: z.array(z.string().max(60)).max(10).optional() });

/** POST /api/posts/research — trending-topic cards for the AI panel. Free: no model call charges until a post is actually written. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Pass a query.", 422);
  const topics = await findTrendingTopics(parsed.data.query, parsed.data.hashtags ?? []);
  return ok({ topics });
}
