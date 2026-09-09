/**
 * Segments = lead groups. A segment is either "static" (an explicit set of lead ids) or
 * "dynamic" (a saved filter over tags / stage / company). Both resolve to a concrete list
 * of lead ids at enrollment time, always re-scoped to the org.
 */
import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

export interface SegmentFilter {
  tags?: string[];
  stage?: string;
  companyContains?: string;
}

/** Build the Prisma `where` for a dynamic segment filter, scoped to an org. */
export function filterToWhere(orgId: string, filter: SegmentFilter): Prisma.LeadWhereInput {
  return {
    organizationId: orgId,
    ...(filter.tags?.length ? { tags: { hasSome: filter.tags } } : {}),
    ...(filter.stage ? { stage: filter.stage as never } : {}),
    ...(filter.companyContains
      ? { company: { contains: filter.companyContains, mode: "insensitive" } }
      : {}),
  };
}

/** Resolve a segment to the lead ids it currently contains (org-scoped). */
export async function resolveSegmentLeadIds(orgId: string, segmentId: string): Promise<string[]> {
  const seg = await prisma.segment.findFirst({ where: { id: segmentId, organizationId: orgId } });
  if (!seg) return [];

  if (seg.kind === "static") {
    const leads = await prisma.lead.findMany({
      where: { id: { in: seg.leadIds }, organizationId: orgId },
      select: { id: true },
    });
    return leads.map((l) => l.id);
  }

  const leads = await prisma.lead.findMany({
    where: filterToWhere(orgId, (seg.filter ?? {}) as SegmentFilter),
    select: { id: true },
  });
  return leads.map((l) => l.id);
}

