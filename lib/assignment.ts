/**
 * Who a new contact lands on.
 *
 * Two things were wrong before. Auto-assignment existed (`computeAutoAssignee`
 * in lib/pipeline.ts) but hung off `Pipeline`, so it was keyed by department and
 * fired only through `addToPipeline` — meaning a webhook lead got an owner while
 * a CSV import, a manual add or anything else left `Lead.ownerId` null. And the
 * rule could not vary by where the contact came from, which is the thing a sales
 * team actually wants: IndiaMART to Priya, ads round-robin across Sales.
 *
 * Now the rule lives on `LeadSource` and runs on every intake path. That matters
 * more than it used to: with the shared pool gone (lib/scope.ts), an unassigned
 * contact is invisible to every rep, so assignment failing quietly is the same
 * as the contact not arriving.
 */
import { prisma } from "./db";
import type { Department } from "@prisma/client";

// Rule names and labels live in a dependency-free module so client components
// can import them without pulling prisma (and node:crypto) into the bundle.
export { ASSIGNMENT_RULES, ASSIGNMENT_RULE_LABELS, type AssignmentRule } from "./assignment-rules";
import type { AssignmentRule } from "./assignment-rules";

/** The pool a rule rotates through: a department, or the whole workspace. */
async function poolUserIds(orgId: string, department: Department | null): Promise<string[]> {
  const members = await prisma.member.findMany({
    where: { organizationId: orgId, ...(department ? { department } : {}) },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** Fewest open contacts wins. Someone with none never appears in the groupBy. */
async function lightestLoad(orgId: string, pool: string[]): Promise<string> {
  const counts = await prisma.lead.groupBy({
    by: ["ownerId"],
    where: { organizationId: orgId, ownerId: { in: pool }, stage: { notIn: ["won", "lost"] } },
    _count: { _all: true },
  });
  const countFor = new Map(counts.filter((c) => c.ownerId).map((c) => [c.ownerId as string, c._count._all]));
  let best = pool[0];
  let bestCount = countFor.get(best) ?? 0;
  for (const userId of pool) {
    const c = countFor.get(userId) ?? 0;
    if (c < bestCount) {
      best = userId;
      bestCount = c;
    }
  }
  return best;
}

export interface AssignmentContext {
  /** LeadSource.key — "indiamart", "csv", "manual", "linkedin_search", … */
  sourceKey?: string | null;
  /** Whoever is doing the importing/adding, used as the last-resort fallback. */
  actorId?: string | null;
}

/**
 * Resolve an owner for a new contact, or null to leave it unassigned.
 *
 * Never throws: a rule that cannot resolve (empty department, deleted member)
 * returns null and the contact surfaces in the Unassigned view. Failing the
 * whole intake because nobody is in a department would lose the lead entirely,
 * which is strictly worse than an unowned one somebody can see.
 */
export async function resolveLeadOwner(orgId: string, ctx: AssignmentContext = {}): Promise<string | null> {
  const source = ctx.sourceKey
    ? await prisma.leadSource.findUnique({
        where: { organizationId_key: { organizationId: orgId, key: ctx.sourceKey } },
      })
    : null;

  // No source, or no rule set on it: the person doing the adding owns what they
  // added. That is the least surprising default for a manual add, and it is what
  // the manual path did before this existed.
  if (!source || source.assignmentRule === "manual") return ctx.actorId ?? null;

  const rule = source.assignmentRule as AssignmentRule;

  if (rule === "fixed") {
    if (!source.assignedToId) return ctx.actorId ?? null;
    // Confirm they are still in the org — a rule pointing at someone who left
    // should fall back, not assign work to a ghost.
    const still = await prisma.member.findFirst({
      where: { organizationId: orgId, userId: source.assignedToId },
      select: { id: true },
    });
    return still ? source.assignedToId : (ctx.actorId ?? null);
  }

  const pool = await poolUserIds(orgId, source.assignmentDept);
  if (pool.length === 0) return ctx.actorId ?? null;

  if (rule === "workload") return lightestLoad(orgId, pool);

  // round_robin — advance the cursor, wrapping. indexOf returning -1 for a
  // cursor pointing at someone who has left restarts the rotation, which is the
  // right behaviour: the alternative is getting stuck on a missing member.
  const lastIdx = source.lastAssignedUserId ? pool.indexOf(source.lastAssignedUserId) : -1;
  const next = pool[(lastIdx + 1) % pool.length];
  await prisma.leadSource.update({ where: { id: source.id }, data: { lastAssignedUserId: next } });
  return next;
}
