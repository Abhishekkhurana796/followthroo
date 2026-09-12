import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { claimActions, completeAction, noteLimitReached, peekActions } from "@/lib/linkedin/queue";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

// GET — extension polls for its next batch of actions (marks them in_progress).
export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  await prisma.linkedInAccount.update({
    where: { id: account.id },
    data: { lastSeenAt: new Date(), status: "connected" },
  });

  // `peek` is a look, not a claim. The desktop app asks for this before a run so
  // it can show exactly who is about to be contacted; it must not consume the
  // queue, or opening the app would quietly mark people in_progress and the list
  // you were shown would be the list you could no longer choose not to send.
  if (req.nextUrl.searchParams.get("peek")) {
    const upto = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1), 50);
    const peek = await peekActions(account, upto);
    return withCors(
      ok({
        pacing: { minDelaySec: account.minDelaySec, maxDelaySec: account.maxDelaySec },
        autoSend: account.autoSend,
        dailyInviteCap: account.dailyInviteCap,
        people: peek.people,
        // Invitations that would go out but are waiting — on somebody's pick, or
        // on tomorrow's notes. Kept apart from `people` so a desktop app too old
        // to know about them still shows exactly who is next.
        held: peek.held,
        notes: peek.notes,
      })
    );
  }

  // Only the desktop app may claim work.
  //
  // The extension stopped asking for actions in 3.0.0, but an installed 2.5.x
  // keeps polling this endpoint with the same pairing token and there is no way
  // to make somebody update. Two clients claiming from one queue means the same
  // person gets invited twice, and an invitation cannot be recalled — so the
  // rule is enforced here rather than trusted to whatever is installed.
  //
  // An old client sees an empty queue rather than an error, which is exactly
  // what it should do with it: nothing.
  const client = req.headers.get("x-followthroo-client");
  if (client !== "desktop") {
    return withCors(
      ok({
        pacing: { minDelaySec: account.minDelaySec, maxDelaySec: account.maxDelaySec },
        mode: account.mode,
        actions: [],
        note: "Invitations are sent by the Followthroo desktop app. This client can only read.",
      })
    );
  }

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 3), 1), 10);
  const actions = await claimActions(account, limit);

  return withCors(
    ok({
      pacing: { minDelaySec: account.minDelaySec, maxDelaySec: account.maxDelaySec },
      mode: account.mode,
      // Hand-picked rather than spread, so a new column on LinkedInAction never
      // leaks to the extension by accident. The cost of that is this list has to
      // be kept in step: autoSend was computed by claimActions and dropped right
      // here, so the extension always saw undefined, always drafted, and left
      // the tab sitting open. The verification for it asserted claimActions
      // rather than this response, so it passed while the feature did nothing.
      actions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        linkedinUrl: a.linkedinUrl,
        note: a.note,
        noteChoice: a.noteChoice,
        leadName: a.leadName,
        autoSend: a.autoSend,
      })),
    })
  );
}

const Report = z.object({
  actionId: z.string(),
  // "drafted" is a non-terminal checkpoint — tab opened and filled, awaiting the human's
  // own Send click — reported so the queue's daily cap and stale-reclaim both see it.
  status: z.enum(["sent", "failed", "skipped", "drafted"]),
  result: z.string().optional(),
  // A machine-readable reason from the desktop app (outcome-codes.js). Optional
  // and additive — stored in activity metadata. NOTE_LIMIT_REACHED is the one
  // the server acts on.
  code: z.string().max(64).optional(),
  /** What was actually done. Optional: the server derives it from the action's type otherwise. */
  kind: z.enum(["invite", "message"]).optional(),
  liMemberName: z.string().optional(),
});

// POST — extension reports the outcome of an action.
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Report.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail("expected { actionId, status }"));

  if (parsed.data.liMemberName && parsed.data.liMemberName !== account.liMemberName) {
    await prisma.linkedInAccount.update({ where: { id: account.id }, data: { liMemberName: parsed.data.liMemberName } }).catch(() => {});
  }

  // LinkedIn said the day's notes are gone. Not an outcome for this person — the
  // invitation goes back in the queue to wait for tomorrow with its note.
  if (parsed.data.code === "NOTE_LIMIT_REACHED") {
    const requeued = await noteLimitReached(account.id, account.organizationId, parsed.data.actionId, parsed.data.result);
    return withCors(ok({ ok: true, requeued }));
  }

  const updated = await completeAction(account.organizationId, parsed.data);
  if (!updated) return withCors(fail("action not found", 404));
  return withCors(ok({ ok: true }));
}
