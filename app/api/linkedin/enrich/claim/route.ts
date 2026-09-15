import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { claimEnrichments } from "@/lib/linkedin/enrich";
import { requireFeature } from "@/lib/billing/limits";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/linkedin/enrich/claim — desktop-only, same bearer as the invite
 * queue. Hands out the next batch of Contact-info lookups, paid for as
 * they're claimed. Runs after the invite lane empties in runner.js.
 */
export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const locked = await requireFeature(account.organizationId, "linkedin_enrichment", "LinkedIn profile enrichment");
  if (locked) return withCors(locked);

  const client = req.headers.get("x-followthroo-client");
  if (client !== "desktop") return withCors(ok({ lookups: [] }));

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 1), 1), 10);
  const lookups = await claimEnrichments(account, limit);
  return withCors(ok({ lookups }));
}
