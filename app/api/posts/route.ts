import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { requireModel, writePosts } from "@/lib/posts/write";

export const runtime = "nodejs";

/** GET /api/posts?platform=linkedin&status=needs_review — the Posts home list. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const platform = req.nextUrl.searchParams.get("platform") ?? "linkedin";
  const status = req.nextUrl.searchParams.get("status");

  const posts = await prisma.post.findMany({
    where: { organizationId: ctx.orgId, platform, ...(status ? { status } : {}) },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return ok(posts);
}

const Body = z.object({
  body: z.string().min(1).max(3000),
  mediaUrl: z.string().url().nullable().optional(),
  mediaAlt: z.string().max(300).nullable().optional(),
  /** Write it with AI first — pass a topic/brief and a model instead of `body`. */
  write: z
    .object({
      model: z.string(),
      brief: z.string().max(2000).optional(),
      topic: z.object({ topic: z.string(), why: z.string(), sources: z.array(z.object({ title: z.string(), url: z.string() })) }).optional(),
    })
    .optional(),
});

/** POST /api/posts — a manual draft, written by hand or by AI (one variant, this endpoint always writes exactly one). */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  if (parsed.data.write) {
    let model;
    try {
      model = requireModel(parsed.data.write.model);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "invalid model", 422);
    }
    const { posts, failed } = await writePosts({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      model,
      brief: parsed.data.write.brief,
      topic: parsed.data.write.topic,
      variants: 1,
    });
    if (!posts.length) return fail(failed ? "Out of credits for AI writing." : "The model didn't return anything usable.", failed ? 402 : 502);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: posts[0].postId } });
    return ok(post, { status: 201 });
  }

  const post = await prisma.post.create({
    data: { organizationId: ctx.orgId, userId: ctx.userId, status: "draft", body: parsed.data.body, mediaUrl: parsed.data.mediaUrl ?? null, mediaAlt: parsed.data.mediaAlt ?? null },
  });
  return ok(post, { status: 201 });
}
