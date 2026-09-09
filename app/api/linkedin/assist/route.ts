import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { decideNextAction, pilotAvailable, PilotObservationSchema } from "@/lib/linkedin/pilot";

export const runtime = "nodejs";
// A model call plus a screenshot upload comfortably exceeds the default.
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

// The schema lives beside the type it validates, in lib/linkedin/pilot.ts. It
// used to be duplicated here, and the copy fell behind: it did not declare
// `inTopCard`, `section` or `y`, so Zod stripped all three out of every
// observation and the prompt lost the one marker that says which "Connect"
// belongs to this profile.

/**
 * POST /api/linkedin/assist — what should the desktop app click next?
 *
 * The model key stays server-side: the desktop client holds only a pairing
 * token, and a provider key inside a downloadable binary belongs to whoever
 * unzips it.
 *
 * This decides; it does not act. Every decision is re-checked against the
 * profile owner's name and a destructive-label list on the client before
 * anything is clicked, because being wrong here must cost a failed action
 * rather than an invitation that cannot be recalled.
 */
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  if (!pilotAvailable()) {
    return withCors(fail("No model is configured on this deployment.", 503));
  }

  const parsed = PilotObservationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(fail(parsed.error.issues[0]?.message ?? "invalid observation"));
  }

  try {
    const decision = await decideNextAction(parsed.data);
    return withCors(ok({ decision }));
  } catch (e) {
    // A model that is unavailable or talking nonsense must not read as "this
    // profile has no Connect button" — the run needs to tell those apart.
    return withCors(fail(`pilot failed: ${String((e as Error).message).slice(0, 200)}`, 502));
  }
}
