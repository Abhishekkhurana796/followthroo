import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agent";
import { configured } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Fluid Compute default

const RunAgent = z.object({
  // One lead per run. This endpoint sends real messages, and its only caller is
  // the Test emails screen — an unbounded array here was a 200-recipient blast
  // one request away. runAgent itself stays multi-lead capable for future use.
  leadIds: z.array(z.string()).min(1).max(1, "Send a test to one lead at a time."),
  brief: z.string().min(1),
  maxSteps: z.number().min(1).max(50).optional(),
  sendingAccountId: z.string().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrg(req);
    if (ctx instanceof Response) return ctx;
    if (!configured.agent) {
      return fail(
        "No AI provider configured — set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) and redeploy.",
        503,
      );
    }

    const parsed = RunAgent.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "expected { leadIds[], brief, maxSteps?, sendingAccountId?, confidenceThreshold? }");

    if (parsed.data.sendingAccountId) {
      const owned = await prisma.sendingAccount.findFirst({
        where: { id: parsed.data.sendingAccountId, organizationId: ctx.orgId },
        select: { id: true },
      });
      if (!owned) return fail("Sending account not found", 404);
    }

    const result = await runAgent({ orgId: ctx.orgId, userId: ctx.userId, ...parsed.data });
    return ok(result);
  } catch (err) {
    console.error("[api/agent] Agent execution failed:", err);
    return fail(err instanceof Error ? err.message : "Internal Server Error", 500);
  }
}
