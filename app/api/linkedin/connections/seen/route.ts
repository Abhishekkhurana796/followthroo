import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { recordConnectionsSeen } from "@/lib/linkedin/queue";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

const Body = z.object({ profileUrls: z.array(z.string().max(500)).min(1).max(200) });

/**
 * POST /api/linkedin/connections/seen — people who are now your connections.
 *
 * Sent by whichever client happens to be looking at the connections list: the
 * desktop app at the start of a run, or the extension while you are on the page.
 * See recordConnectionsSeen for why that list is the only honest signal that an
 * invitation was accepted.
 *
 * Claims nothing, so two clients sending the same list cannot collide — the
 * one-claimer rule is about taking work from the queue, and this takes none.
 */
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail("Expected { profileUrls: string[] }, up to 200.", 422));

  return withCors(ok(await recordConnectionsSeen(account.organizationId, parsed.data.profileUrls)));
}
