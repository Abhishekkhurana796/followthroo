import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { enqueueLinkedInAction } from "@/lib/linkedin/queue";
import { resolveSegmentLeadIds } from "@/lib/segments";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { INVITE_NOTE_MAX } from "@/lib/linkedin/note";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

// POST /api/linkedin/run (Bearer extToken) — "run a book/group directly": enqueue LinkedIn
// actions for the contacts in a group (or an explicit lead set) that have a profile URL.
const Body = z.object({
  segmentId: z.string().optional(),
  leadIds: z.array(z.string()).optional(),
  // LinkedIn's own ceiling on a connection note (docs/phantombuster.md #18).
  // This used to allow 600 while extension/background.js sliced at 300, so a
  // rendered template in between was cut mid-word in the rep's face. Reject it
  // here instead, where the author can still fix the template.
  note: z
    .string()
    .max(INVITE_NOTE_MAX, `A LinkedIn invite note cannot be longer than ${INVITE_NOTE_MAX} characters.`)
    .optional(),
  type: z.enum(["auto", "invite", "message"]).default("auto"),
});

export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);
  const orgId = account.organizationId;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail(parsed.error.issues[0]?.message ?? "invalid body"));

  let leadIds = parsed.data.leadIds ?? [];
  if (parsed.data.segmentId) leadIds = await resolveSegmentLeadIds(orgId, parsed.data.segmentId);
  if (leadIds.length === 0) return withCors(fail("no contacts to run — pick a group with LinkedIn contacts"));

  // Only contacts that actually have a LinkedIn profile can be actioned.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, organizationId: orgId, linkedinUrl: { not: null } },
    select: { id: true, linkedinUrl: true },
  });
  if (leads.length === 0) return withCors(fail("none of those contacts have a LinkedIn URL"));

  let queued = 0;
  for (const lead of leads) {
    await enqueueLinkedInAction({
      organizationId: orgId,
      leadId: lead.id,
      linkedinUrl: lead.linkedinUrl!,
      note: parsed.data.note ?? null,
      type: parsed.data.type,
    });
    queued++;
  }
  return withCors(ok({ queued, skipped: leadIds.length - leads.length }));
}
