import { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireExtAuth } from "@/lib/linkedin/auth";
import { corsPreflight, withCors } from "@/lib/linkedin/cors";
import { peekEnrichments } from "@/lib/linkedin/enrich";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

/** GET — read the desktop enrichment queue without claiming or charging it. */
export async function GET(req: NextRequest) {
  const account = await requireExtAuth(req);
  if (account instanceof Response) return withCors(account);

  const client = req.headers.get("x-followthroo-client");
  if (client !== "desktop") return withCors(ok({ queued: 0, people: [], daily: { used: 0, cap: 0, remaining: 0 } }));

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1), 50);
  return withCors(ok(await peekEnrichments(account, limit)));
}
