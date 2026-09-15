import type { Prisma } from "@prisma/client";
import { resolveSegmentLeadIds } from "./segments";

/** Filters shared by the lead table and its CSV export. */
export type LeadFilters = {
  stage?: string;
  q?: string;
  company?: string;
  book?: string;
  group?: string;
  tags?: string[];
  ids?: string[];
  owner?: string;
  source?: string;
};

export function readLeadFilters(searchParams: URLSearchParams): LeadFilters {
  const list = (key: string) => searchParams.get(key)?.split(",").map((v) => v.trim()).filter(Boolean);
  return {
    stage: searchParams.get("stage") || undefined,
    q: searchParams.get("q")?.trim() || undefined,
    company: searchParams.get("company")?.trim() || undefined,
    book: searchParams.get("book") || undefined,
    group: searchParams.get("group") || undefined,
    tags: list("tags"),
    ids: list("ids"),
    owner: searchParams.get("owner") || undefined,
    source: searchParams.get("source") || undefined,
  };
}

/**
 * Adds person-selected filters to an already-authorized lead scope. The caller
 * always provides that scope first, so a member can never widen an export or
 * table query by naming someone else's owner id in the URL.
 */
export async function leadWhere(
  organizationId: string,
  scope: Prisma.LeadWhereInput,
  filters: LeadFilters,
): Promise<Prisma.LeadWhereInput> {
  const groupIds = filters.group ? await resolveSegmentLeadIds(organizationId, filters.group) : undefined;
  const ids = filters.ids ?? groupIds;
  return {
    AND: [scope],
    ...(ids ? { id: { in: ids } } : {}),
    ...(filters.stage ? { stage: filters.stage as never } : {}),
    ...(filters.company ? { company: { equals: filters.company, mode: "insensitive" } } : {}),
    ...(filters.book === "email" ? { email: { not: null } } : filters.book === "linkedin" ? { linkedinUrl: { not: null } } : {}),
    ...(filters.tags?.length ? { tags: { hasSome: filters.tags } } : {}),
    ...(filters.owner === "unassigned" ? { ownerId: null } : filters.owner ? { ownerId: filters.owner } : {}),
    ...(filters.source ? { leadSource: { key: filters.source } } : {}),
    ...(filters.q
      ? {
          OR: [
            { email: { contains: filters.q, mode: "insensitive" } },
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { company: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export function leadFiltersKey(filters: LeadFilters) {
  return [filters.stage, filters.company, filters.book, filters.group, filters.tags?.join("|"), filters.q, filters.owner, filters.source].join(":");
}
