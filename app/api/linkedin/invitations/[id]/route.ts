import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { updateQueuedInvitation } from "@/lib/linkedin/queue";
import { INVITE_NOTE_MAX } from "@/lib/linkedin/note";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

const Patch = z
  .object({
    noteChoice: z.enum(["yes", "no"]).optional(),
    // Loose on length here; updateQueuedInvitation measures the trimmed note
    // and says exactly how far over it is.
    note: z.string().max(INVITE_NOTE_MAX * 4).nullable().optional(),
  })
  .refine((b) => b.noteChoice !== undefined || b.note !== undefined, "nothing to change");

/**
 * Decide a queued invitation's note: on, off, or reworded.
 *
 * Two callers, authenticated differently — the LinkedIn screen with a session,
 * the desktop app's Up next list with its pairing token — and one rule for both,
 * in updateQueuedInvitation: only while the invitation is still pending.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bearer = (req.headers.get("authorization") ?? "").startsWith("Bearer ");
  const respond = (r: Response) => (bearer ? withCors(r) : r);

  let organizationId: string;
  if (bearer) {
    const account = await requireExtAuth(req);
    if (account instanceof Response) return withCors(account);
    organizationId = account.organizationId;
  } else {
    const ctx = await requireOrg(req);
    if (ctx instanceof Response) return ctx;
    organizationId = ctx.orgId;
  }

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return respond(fail(parsed.error.issues[0]?.message ?? "invalid body"));

  const result = await updateQueuedInvitation(organizationId, id, parsed.data);
  if (!result.ok) return respond(fail(result.error, result.status));
  return respond(ok({ noteChoice: result.noteChoice, note: result.note }));
}
