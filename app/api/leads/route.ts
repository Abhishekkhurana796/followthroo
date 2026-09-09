import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { leadScope, resolveViewAs, unassignedScope } from "@/lib/scope";
import { canAssignTo } from "@/lib/tasks";
import { ensureSource } from "@/lib/identity";
import { resolveLeadOwner } from "@/lib/assignment";
import { resolveSegmentLeadIds } from "@/lib/segments";
import { enrichLeadRows } from "@/lib/queries";
import { cached, invalidate } from "@/lib/cache";

export const runtime = "nodejs";

// A contact needs an email (Book 1) OR a LinkedIn URL (Book 2).
const CreateLead = z
  .object({
    email: z.string().email().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    linkedinUrl: z.string().url().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
    /** LeadSource.key. Defaults to "manual" — a contact typed in by hand has a
     *  source, and leaving it null is what produced the "Added by hand" bucket. */
    sourceKey: z.string().optional(),
    /** userId to assign to. Defaults to whoever is adding it. */
    ownerId: z.string().optional(),
  })
  .refine((d) => d.email || d.linkedinUrl, { message: "add an email or a LinkedIn URL" });

// GET /api/leads?stage=&q=&tags=a,b&company=&book=email|linkedin&group=<segmentId>&page=&pageSize=
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { orgId } = ctx;

  const { searchParams } = new URL(req.url);

  // Who this caller may see. `?member=` narrows further, for the owner's
  // per-person drill-down; naming somebody they may not see is a 403 rather than
  // a silently wider list, which would be the worst failure mode here.
  const viewAs = await resolveViewAs(ctx, searchParams.get("member"));
  if (viewAs === null) return fail("You cannot view that member's contacts.", 403);

  // ?view=unassigned — contacts no rule has landed on. Not part of anyone's
  // scope by design, so it is a separate view rather than a filter, and only
  // the roles accountable for the work getting done can open it.
  const wantsUnassigned = searchParams.get("view") === "unassigned";
  const unassigned = wantsUnassigned ? unassignedScope(ctx) : null;
  if (wantsUnassigned && !unassigned) return fail("Only owners, admins and managers can see unassigned contacts.", 403);

  const scope = unassigned ? { where: unassigned, userIds: null } : await leadScope(ctx, viewAs);

  const stage = searchParams.get("stage") ?? undefined;
  const q = searchParams.get("q")?.trim() || undefined;
  const company = searchParams.get("company")?.trim() || undefined;
  const book = searchParams.get("book") ?? undefined; // "email" | "linkedin"
  const group = searchParams.get("group") ?? undefined; // segmentId
  const tags = searchParams.get("tags")?.split(",").map((t) => t.trim()).filter(Boolean);
  const ids = searchParams.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean);

  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? searchParams.get("take") ?? 50), 1), 500);
  const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
  const skip = searchParams.has("skip") ? Number(searchParams.get("skip")) : (page - 1) * pageSize;

  // A saved group resolves to a concrete set of lead ids (static or dynamic).
  const groupIds = group ? await resolveSegmentLeadIds(orgId, group) : undefined;
  const idFilter = ids ?? groupIds;

  // AND, not a spread: the scope carries its own OR (assigned / created by me /
  // unassigned) and the search below carries another. Merged into one object the
  // second would silently replace the first and widen the result set.
  const where: Prisma.LeadWhereInput = {
    AND: [scope.where],
    ...(idFilter ? { id: { in: idFilter } } : {}),
    ...(stage ? { stage: stage as never } : {}),
    ...(company ? { company: { equals: company, mode: "insensitive" } } : {}),
    ...(book === "email" ? { email: { not: null } } : book === "linkedin" ? { linkedinUrl: { not: null } } : {}),
    ...(tags && tags.length ? { tags: { hasSome: tags } } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // The scope is part of the cache key: without it a member would be served the
  // owner's cached count and see a total that does not match their own list.
  const scopeKey = scope.userIds ? scope.userIds.join("+") : "all";
  const filterKey = `leads:count:${orgId}:${scopeKey}:${stage ?? ""}:${company ?? ""}:${book ?? ""}:${group ?? ""}:${(tags ?? []).join("|")}:${q ?? ""}`;
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: pageSize, skip }),
    cached(filterKey, 15_000, () => prisma.lead.count({ where })),
  ]);

  // Source / owner / last activity / next action are all derived, so they're
  // attached here rather than denormalised onto Lead where they'd go stale.
  const items = await enrichLeadRows(orgId, rows);

  return ok({ items, total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) });
}

// POST /api/leads — create/update a contact. Dedupe by (org,email) when an email is given,
// else by (org,linkedinUrl) for LinkedIn-only contacts (Book 2).
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { orgId } = ctx;

  const parsed = CreateLead.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  const { email, custom, sourceKey, ownerId, ...rest } = parsed.data;
  const customJson = (custom ?? {}) as Prisma.InputJsonValue;

  // You may only hand a new contact to somebody you could assign work to.
  if (ownerId && !(await canAssignTo(ctx, ownerId))) {
    return fail("You cannot assign a contact to that member.", 403);
  }

  // A contact added here was added by a person, so it gets the "manual" source
  // rather than none. Only the webhook path used to tag a source at all, which
  // is why most contacts had none.
  const leadSourceId = await ensureSource(orgId, sourceKey ?? "manual");

  // An explicit pick wins; otherwise the source's rule decides, falling back to
  // the person adding it. Manual adds default to "manual" source, whose rule is
  // also `manual`, so the common case still lands on you.
  const resolvedOwner = ownerId ?? (await resolveLeadOwner(orgId, { sourceKey: sourceKey ?? "manual", actorId: ctx.userId }));

  const provenance = {
    leadSourceId,
    ownerId: resolvedOwner,
    createdById: ctx.userId,
    createdKind: "user",
  };

  let lead;
  // Whether this was a create or an update is the single most useful thing the
  // caller can know. Adding an address that already exists updates the row in
  // place and — correctly — leaves `createdAt` alone, so the lead does not move
  // to the top of a newest-first list. Without this flag that reads as "my lead
  // vanished", which is exactly how it was reported.
  let created = true;
  if (email) {
    const existing = await prisma.lead.findUnique({
      where: { organizationId_email: { organizationId: orgId, email } },
      select: { id: true },
    });
    created = !existing;
    lead = await prisma.lead.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { email, organizationId: orgId, ...rest, ...provenance, custom: customJson },
      // Deliberately not re-applying provenance: re-adding an address must not
      // reassign a contact somebody else is already working.
      update: { ...rest, ...(custom ? { custom: customJson } : {}) },
    });
  } else {
    // LinkedIn-only contact — dedupe on the profile URL (no composite unique to rely on).
    const existing = await prisma.lead.findFirst({ where: { organizationId: orgId, linkedinUrl: rest.linkedinUrl } });
    created = !existing;
    lead = existing
      ? await prisma.lead.update({ where: { id: existing.id }, data: { ...rest, ...(custom ? { custom: customJson } : {}) } })
      : await prisma.lead.create({ data: { organizationId: orgId, ...rest, ...provenance, custom: customJson } });
  }
  invalidate("leads:");
  invalidate("stats");
  return ok({ ...lead, created }, { status: created ? 201 : 200 });
}
