/**
 * Who can see which contacts — one rule, applied everywhere.
 *
 * Before this, every read was scoped to the organization and nothing further, so
 * a new hire on their first day saw the whole company's book: every contact,
 * every reply, every overdue task. That is fine for a single-operator tool and
 * wrong for a product sold to teams.
 *
 * The rule:
 *   owner / admin   → the whole workspace
 *   group_leader    → their department's contacts, and anything they added
 *   member          → assigned to them, or added by them. Nothing else.
 *
 * There is deliberately no shared pool. An earlier version let everyone see
 * unassigned contacts so a fresh import was workable before anyone claimed it;
 * that was reversed on the grounds that work assigned to a person should be
 * visible to that person alone. The consequence is that assignment has to
 * actually happen — see lib/assignment.ts, which runs on every intake path —
 * and that unassigned contacts need a home of their own rather than being
 * quietly unreachable. That is `unassignedScope` below.
 *
 * `viewAs` powers the owner's "View: All team ▼" drill-down. It narrows to one
 * person *within* what the caller may already see, so it can only ever subtract.
 * That is what lets one rendering path serve both the member's own dashboard and
 * the owner looking at that member.
 */
import { prisma } from "./db";
import { seesEverything } from "./roles";
import type { TenantContext } from "./tenant";
import type { Department, Prisma } from "@prisma/client";

/** userIds of everyone in the caller's department (plus the caller). */
async function departmentUserIds(ctx: TenantContext): Promise<string[]> {
  if (!ctx.department) return [ctx.userId];
  const members = await prisma.member.findMany({
    where: { organizationId: ctx.orgId, department: ctx.department as Department },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  if (!ids.includes(ctx.userId)) ids.push(ctx.userId);
  return ids;
}

export interface LeadScope {
  where: Prisma.LeadWhereInput;
  /** userIds this scope covers, or null when the scope is the whole org. */
  userIds: string[] | null;
}

/**
 * Build the Lead `where` for this caller.
 *
 * Always spreads over `organizationId`, so it can be handed straight to a query
 * without the caller remembering to add tenancy on top.
 */
export async function leadScope(ctx: TenantContext, viewAs?: string | null): Promise<LeadScope> {
  const org: Prisma.LeadWhereInput = { organizationId: ctx.orgId };

  // Drill-down to one person. Authorization for *who* may be named is the
  // caller's business (see canViewAs) — by the time we are here it is allowed.
  if (viewAs) {
    return {
      where: { ...org, OR: [{ ownerId: viewAs }, { createdById: viewAs }] },
      userIds: [viewAs],
    };
  }

  if (seesEverything(ctx.role)) return { where: org, userIds: null };

  const ids = await departmentUserIds(ctx);

  if (ctx.role === "group_leader") {
    return {
      where: { ...org, OR: [{ ownerId: { in: ids } }, { createdById: { in: ids } }] },
      userIds: ids,
    };
  }

  // Plain member.
  return {
    where: { ...org, OR: [{ ownerId: ctx.userId }, { createdById: ctx.userId }] },
    userIds: [ctx.userId],
  };
}

/**
 * Contacts nobody owns.
 *
 * The scope above deliberately excludes these: work assigned to a person is
 * theirs alone, so there is no shared pool to browse. That makes an unassigned
 * contact invisible to every rep — which is correct, and also exactly how an
 * import could silently vanish if an assignment rule failed.
 *
 * So unassigned is a place, not a gap. Owners, admins and managers get a view
 * of it (and a count on Home), which turns a broken rule into something visible
 * rather than something nobody notices for a month.
 */
export function unassignedScope(ctx: TenantContext): Prisma.LeadWhereInput | null {
  if (!canSeeUnassigned(ctx.role)) return null;
  return { organizationId: ctx.orgId, ownerId: null };
}

/**
 * Which userIds' tasks this caller may see, or null for "everyone".
 *
 * Tasks were never scoped at all: /api/tasks narrowed only on an opt-in
 * `?mine=1`, so the Tasks screen listed every task in the workspace — titles,
 * contacts and owner names — to anyone who opened it. Same class of leak as the
 * contacts one, one screen over.
 *
 * Deliberately mirrors `assignableMembers` in lib/tasks.ts: who you can SEE
 * work for and who you can GIVE work to should be the same set of people, or
 * the Tasks screen and the assignee picker start disagreeing about the org
 * chart.
 */
export async function taskOwnerScope(ctx: TenantContext): Promise<string[] | null> {
  if (seesEverything(ctx.role)) return null;
  if (ctx.role === "group_leader") return departmentUserIds(ctx);
  return [ctx.userId];
}

/** Owner, admin and manager — the roles accountable for work landing on someone. */
export function canSeeUnassigned(role: string): boolean {
  return seesEverything(role) || role === "group_leader";
}

/**
 * May this caller view the workspace as `targetUserId`?
 *
 * Owners and admins may name anyone in the org. A manager may name someone in
 * their own department. Everyone may name themselves — which is what makes
 * `?member=<me>` harmless rather than a special case.
 */
export async function canViewAs(ctx: TenantContext, targetUserId: string): Promise<boolean> {
  if (targetUserId === ctx.userId) return true;
  if (seesEverything(ctx.role)) {
    const member = await prisma.member.findFirst({
      where: { organizationId: ctx.orgId, userId: targetUserId },
      select: { id: true },
    });
    return !!member;
  }
  if (ctx.role !== "group_leader" || !ctx.department) return false;
  const member = await prisma.member.findFirst({
    where: { organizationId: ctx.orgId, userId: targetUserId, department: ctx.department as Department },
    select: { id: true },
  });
  return !!member;
}

/**
 * Resolve the `?member=` query parameter into a validated viewAs id.
 *
 * Returns `undefined` when absent, `null` when present but not permitted — the
 * caller should treat null as a 403 rather than silently widening the view,
 * which would be the worst possible failure mode for this particular feature.
 */
export async function resolveViewAs(
  ctx: TenantContext,
  raw: string | null | undefined
): Promise<string | null | undefined> {
  if (!raw) return undefined;
  return (await canViewAs(ctx, raw)) ? raw : null;
}
