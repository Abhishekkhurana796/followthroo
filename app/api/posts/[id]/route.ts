import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { enqueueJob } from "@/lib/queue";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const post = await prisma.post.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!post) return fail("not found", 404);
  return ok(post);
}

const Patch = z.object({
  body: z.string().min(1).max(3000).optional(),
  mediaUrl: z.string().url().nullable().optional(),
  mediaAlt: z.string().max(300).nullable().optional(),
  /** Set a schedule — moves a draft or an approved review draft to "scheduled". */
  scheduledAt: z.string().datetime().optional(),
  /** Approve a needs_review draft: schedules it now, or publishes immediately if scheduledAt is past/omitted. */
  action: z.enum(["approve", "publish_now", "cancel"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  const post = await prisma.post.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!post) return fail("not found", 404);
  if (!["draft", "needs_review", "scheduled"].includes(post.status)) {
    return fail(`A ${post.status} post can't be edited.`, 409);
  }

  if (parsed.data.action === "cancel") {
    const updated = await prisma.post.update({ where: { id }, data: { status: "draft", scheduledAt: null } });
    return ok(updated);
  }

  const edits: Record<string, unknown> = {};
  if (parsed.data.body !== undefined) edits.body = parsed.data.body;
  if (parsed.data.mediaUrl !== undefined) edits.mediaUrl = parsed.data.mediaUrl;
  if (parsed.data.mediaAlt !== undefined) edits.mediaAlt = parsed.data.mediaAlt;

  if (parsed.data.action === "publish_now") {
    const updated = await prisma.post.update({ where: { id }, data: { ...edits, status: "scheduled", scheduledAt: new Date() } });
    await enqueueJob({ kind: "post-publish", postId: id }, 0);
    return ok(updated);
  }

  if (parsed.data.scheduledAt || parsed.data.action === "approve") {
    const at = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : new Date();
    const updated = await prisma.post.update({ where: { id }, data: { ...edits, status: "scheduled", scheduledAt: at } });
    await enqueueJob({ kind: "post-publish", postId: id }, Math.max(0, at.getTime() - Date.now()));
    return ok(updated);
  }

  const updated = await prisma.post.update({ where: { id }, data: edits });
  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const post = await prisma.post.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!post) return fail("not found", 404);
  if (post.status === "published") return fail("A published post can't be deleted here — remove it on LinkedIn.", 409);
  await prisma.post.delete({ where: { id } });
  return ok({ deleted: true });
}
