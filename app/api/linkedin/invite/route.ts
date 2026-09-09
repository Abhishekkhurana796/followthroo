import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { leadScope } from "@/lib/scope";
import { resolveSegmentLeadIds } from "@/lib/segments";
import { enqueueManyLinkedIn, previewEnqueue } from "@/lib/linkedin/enqueue-many";
import { getOrCreateAccount } from "@/lib/linkedin/auth";
import { scrapeUsageToday } from "@/lib/linkedin/scrape";

export const runtime = "nodejs";

/**
 * Queue LinkedIn actions for a selection of leads, from the app.
 *
 * The same job as `/api/linkedin/run`, which the extension calls with its bearer
 * token. This one is session-authenticated so the Leads screen can do it, which
 * is what was missing: building a whole campaign was the only route to sending a
 * connection request, and that is five steps too many for "invite these forty".
 *
 * The rules about which contacts can be actioned are shared with the extension
 * path in lib/linkedin/enqueue-many.ts. The scoping below is the part that is
 * specific to a person acting in a browser: a member must not be able to queue
 * invites against a colleague's contacts by posting their ids.
 */
const Body = z.object({
  leadIds: z.array(z.string()).max(1000).optional(),
  segmentId: z.string().optional(),
  note: z.string().optional(),
  type: z.enum(["invite", "message"]).default("invite"),
  /** Report what would happen without doing it, for the confirmation dialog. */
  preview: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  let leadIds = parsed.data.leadIds ?? [];
  if (parsed.data.segmentId) leadIds = await resolveSegmentLeadIds(ctx.orgId, parsed.data.segmentId);
  if (!leadIds.length) return fail("Pick some contacts first.");

  // Narrow to what this person is actually allowed to see. Posting a colleague's
  // lead id must not queue an invite from their account.
  const scope = await leadScope(ctx);
  const visible = await prisma.lead.findMany({
    // scope.where already carries organizationId — see leadScope in lib/scope.ts.
    where: { AND: [{ id: { in: leadIds } }, scope.where] },
    select: { id: true },
  });
  const allowed = visible.map((l) => l.id);
  if (!allowed.length) return fail("None of those contacts are yours to action.");

  const account = await getOrCreateAccount(ctx.orgId, ctx.userId);
  const usage = await scrapeUsageToday(ctx.orgId, ctx.userId);

  if (parsed.data.preview) {
    const p = await previewEnqueue(ctx.orgId, allowed);
    return ok({
      ...p,
      outOfScope: leadIds.length - allowed.length,
      autoSend: account.autoSend,
      dailyCap: account.dailyInviteCap,
      remainingToday: usage.remaining,
      minDelaySec: account.minDelaySec,
      maxDelaySec: account.maxDelaySec,
    });
  }

  try {
    const res = await enqueueManyLinkedIn({
      organizationId: ctx.orgId,
      leadIds: allowed,
      note: parsed.data.note,
      type: parsed.data.type,
    });
    return ok({ ...res, autoSend: account.autoSend });
  } catch (e) {
    // The note ceiling is the only thing enqueueManyLinkedIn throws for, and the
    // author can still fix it — so it is a 400 with the reason, not a 500.
    return fail(e instanceof Error ? e.message : "Could not queue those invites.");
  }
}
