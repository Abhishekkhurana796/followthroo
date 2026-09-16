import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { leadScope } from "@/lib/scope";
import { invalidate } from "@/lib/cache";
import { tooMany } from "@/lib/api-ratelimit";
import { applyToQueuedMessages, generateLinkedInMessages } from "@/lib/linkedin/message-writer";
import { LINKEDIN_MESSAGE_MAX } from "@/lib/linkedin/note";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Leads per request. The browser sends a selection in batches of this size, so
 * it can show "8 / 20" between them and one slow model call can never time out
 * a whole selection.
 */
const BATCH_MAX = 5;

const Generate = z.object({
  leadIds: z.array(z.string()).min(1).max(BATCH_MAX),
  /** Replace a hand-edited message. Only a deliberate single Regenerate sends this. */
  overwriteEdited: z.boolean().optional(),
});

/** POST /api/leads/linkedin-message — write and save a LinkedIn message for each lead. Sends nothing. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const limited = await tooMany(`linkedin-message:${ctx.userId}`, { max: 60, windowSec: 60 });
  if (limited) return limited;
  const parsed = Generate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body", 422);

  // Only leads this person can see — org scope alone would let a member write
  // into a colleague's book by passing raw ids.
  const scope = await leadScope(ctx);
  const visible = await prisma.lead.findMany({
    where: { AND: [scope.where], id: { in: parsed.data.leadIds } },
    select: { id: true },
  });
  const allowed = new Set(visible.map((l) => l.id));
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });

  const written = await generateLinkedInMessages({
    organizationId: ctx.orgId,
    leadIds: parsed.data.leadIds.filter((id) => allowed.has(id)),
    senderName: user?.name ?? null,
    overwriteEdited: parsed.data.overwriteEdited === true,
  });
  const denied = parsed.data.leadIds
    .filter((id) => !allowed.has(id))
    .map((leadId) => ({ leadId, status: "failed" as const, reason: "not yours to change" }));

  if (written.some((r) => r.status === "written")) invalidate("leads:");
  return ok({ results: [...written, ...denied] });
}

const Save = z.object({
  leadId: z.string(),
  message: z
    .string()
    .max(LINKEDIN_MESSAGE_MAX, `A LinkedIn message can be at most ${LINKEDIN_MESSAGE_MAX} characters here.`)
    .nullable(),
});

/** PUT /api/leads/linkedin-message — save a person's own edit, or clear the message (null). */
export async function PUT(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Save.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body", 422);

  const text = parsed.data.message?.trim() || null;
  const scope = await leadScope(ctx);
  const res = await prisma.lead.updateMany({
    where: { AND: [scope.where], id: parsed.data.leadId },
    data: {
      linkedinMessage: text,
      // An edit is marked so a later bulk generate keeps it.
      linkedinMessageSource: text ? "edited" : null,
      linkedinMessageUpdatedAt: text ? new Date() : null,
    },
  });
  if (res.count === 0) return fail("That contact isn't yours to change.", 404);
  // Clearing leaves queued actions as they are: their text came from the step's
  // template or an earlier message, and there is nothing better to put back.
  if (text) await applyToQueuedMessages(ctx.orgId, parsed.data.leadId, text);
  invalidate("leads:");
  return ok({ leadId: parsed.data.leadId, message: text });
}
