import { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { createHandoffCode, redeemHandoffCode, handoffAvailable } from "@/lib/desktop-handoff";

export const runtime = "nodejs";

/**
 * POST /api/desktop/handoff — the signed-in browser asks for a code.
 *
 * Session-authenticated, so only somebody already signed in can mint one, and it
 * can only ever carry their own session.
 */
export async function POST(req: NextRequest) {
  if (!handoffAvailable()) {
    return fail("Desktop sign-in is not available on this deployment (no Redis configured).", 503);
  }

  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const sessionToken = getSessionCookie(req);
  if (!sessionToken) return fail("no session to hand over", 401);

  const code = await createHandoffCode(sessionToken);
  if (!code) return fail("could not create a sign-in code", 503);
  return ok({ code });
}

const Exchange = z.object({ code: z.string().min(20).max(200) });

/**
 * PUT /api/desktop/handoff — the desktop app redeems the code.
 *
 * Deliberately unauthenticated: the app has no session yet, which is the entire
 * point. The code is the credential, it is single-use, and it expires in two
 * minutes. Kept on this route rather than a sibling so the two halves of one
 * exchange are read together.
 */
export async function PUT(req: NextRequest) {
  const parsed = Exchange.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("expected { code }");

  const sessionToken = await redeemHandoffCode(parsed.data.code);
  // One message for expired, already-used and never-existed alike — telling them
  // apart would let someone probe which codes were real.
  if (!sessionToken) return fail("that sign-in link has expired or was already used", 401);

  return ok({ sessionToken });
}
