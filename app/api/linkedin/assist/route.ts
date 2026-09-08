import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { decideNextAction, pilotAvailable } from "@/lib/linkedin/pilot";

export const runtime = "nodejs";
// A model call plus a screenshot upload comfortably exceeds the default.
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

const Element = z.object({
  i: z.number().int().min(0),
  tag: z.string().max(20),
  role: z.string().max(40).nullish(),
  label: z.string().max(300),
  disabled: z.boolean().optional(),
  inDialog: z.boolean().optional(),
  inAside: z.boolean().optional(),
});

const Body = z.object({
  goal: z.enum(["invite", "message"]),
  personName: z.string().max(200),
  note: z.string().max(4000).nullable(),
  autoSend: z.boolean(),
  useNote: z.boolean().optional(),
  url: z.string().max(500),
  step: z.number().int().min(0).max(20),
  history: z.array(z.string().max(300)).max(20),
  // Capped so one page cannot turn into an enormous prompt. LinkedIn profiles
  // sit well under this; anything approaching it is a sign the page is not what
  // we think it is.
  elements: z.array(Element).max(200),
  /** Base64 JPEG, no data: prefix. ~1.5MB of base64 is a generous 1080p frame. */
  screenshot: z.string().max(2_000_000).nullish(),
});

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

  const parsed = Body.safeParse(await req.json().catch(() => null));
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
