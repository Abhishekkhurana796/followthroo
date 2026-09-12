import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { enqueueEnrichment, estimateEnrichment } from "@/lib/linkedin/enrich";

export const runtime = "nodejs";

const Body = z.object({ leadIds: z.array(z.string()).min(1).max(2000) });

/**
 * POST /api/linkedin/enrich — queue lookups for the given leads (the Leads bulk
 * action, or a single lead record). Ineligible leads (no LinkedIn URL, opted
 * out) are silently left out rather than queued and immediately skipped.
 *
 * `?estimate=1` is read-only: how many of these leads a lookup would actually
 * run for, for the confirm dialog. Queues nothing.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Pass leadIds.", 422);

  if (req.nextUrl.searchParams.get("estimate")) {
    return ok(await estimateEnrichment(ctx.orgId, parsed.data.leadIds));
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: parsed.data.leadIds }, organizationId: ctx.orgId, optedOut: false, linkedinUrl: { not: null } },
    select: { id: true, linkedinUrl: true },
  });
  const queued = await Promise.all(
    leads.map((l) =>
      enqueueEnrichment({ organizationId: ctx.orgId, leadId: l.id, linkedinUrl: l.linkedinUrl!, source: "bulk" }),
    ),
  );
  return ok({ queued: queued.length, skipped: parsed.data.leadIds.length - queued.length });
}
