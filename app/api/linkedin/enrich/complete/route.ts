import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { completeEnrichment } from "@/lib/linkedin/enrich";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

const Body = z.object({
  enrichmentId: z.string(),
  status: z.enum(["done", "skipped", "failed"]),
  degree: z.enum(["1st", "2nd", "3rd", "out_of_network"]).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  result: z.string().max(500).optional(),
});

/** POST /api/linkedin/enrich/complete — desktop reports what one lookup found. */
export async function POST(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return withCors(fail(parsed.error.issues[0]?.message ?? "invalid body"));

  const result = await completeEnrichment(account.organizationId, parsed.data);
  if (!result) return withCors(fail("lookup not found", 404));
  return withCors(ok(result));
}
