/**
 * Multi-tenancy — resolve the authenticated user + their active organization.
 *
 * Every API route must scope reads/writes to `orgId`. Use `requireOrg(req)` in route
 * handlers (returns a Response to short-circuit on auth failure) and `getServerTenant()`
 * in Server Components (returns null when unauthenticated).
 */
import { cache } from "react";
import type { NextRequest } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { auth, preferredOrganizationId } from "./auth";
import { prisma } from "./db";
import { fail } from "./http";
import { configured } from "./env";

export interface TenantContext {
  userId: string;
  orgId: string;
  role: string; // owner | admin | group_leader | member
  /** Null for owner/admin (unrestricted) or a member never assigned to a department. */
  department: string | null;
}

/** Resolve tenant from a set of request headers (shared by route + RSC paths). */
async function resolveTenant(headers: Headers): Promise<TenantContext | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session?.user) return null;
  const userId = session.user.id;
  const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;

  // Prefer the session's active org; otherwise make the same choice a new
  // session does — never simply the oldest membership, which for an invited
  // teammate is their empty personal workspace.
  let membership = active
    ? await prisma.member.findFirst({ where: { userId, organizationId: active } })
    : null;
  if (!membership) {
    const preferred = await preferredOrganizationId(userId);
    membership = preferred
      ? await prisma.member.findFirst({ where: { userId, organizationId: preferred } })
      : null;
  }
  if (!membership) return null;
  return { userId, orgId: membership.organizationId, role: membership.role, department: membership.department };
}

/**
 * Department gate for group_leader/member (PRD §4: a Group Leader "cannot see other
 * departments' data unless granted"). owner/admin are always unrestricted. A caller with
 * no department assigned yet sees nothing department-scoped until an admin sets one —
 * safer default than accidentally seeing everything.
 */
export function requireDepartmentAccess(ctx: TenantContext, department: string | null): Response | null {
  if (ctx.role === "owner" || ctx.role === "admin") return null;
  if (ctx.role !== "group_leader" && ctx.role !== "member") return null;
  if (department && department === ctx.department) return null;
  return fail("insufficient role", 403);
}

/** True when `ctx` should have its data reads/writes scoped to `ctx.department`. */
export function isDepartmentScoped(ctx: TenantContext): boolean {
  return ctx.role === "group_leader" || ctx.role === "member";
}

/**
 * For API route handlers. Returns the tenant context, or a Response (401/403/503) that
 * the caller must return to short-circuit:
 *   const ctx = await requireOrg(req);
 *   if (ctx instanceof Response) return ctx;
 *   const { orgId } = ctx;
 */
export async function requireOrg(req: NextRequest): Promise<TenantContext | Response> {
  if (!configured.db) return fail("DATABASE_URL not configured — see .env.example", 503);
  const ctx = await resolveTenant(req.headers);
  if (!ctx) return fail("unauthorized", 401);
  return ctx;
}

/**
 * For Server Components. Returns null when unauthenticated / no org.
 *
 * Wrapped in React's `cache()` so the dashboard layout and the page it renders
 * share one session lookup per request instead of each paying for their own.
 * Keyed on the (empty) argument list rather than a Headers object, whose
 * identity would differ between callers and defeat the cache.
 */
export const getServerTenant = cache(async (): Promise<TenantContext | null> => {
  if (!configured.db) return null;
  return resolveTenant(await nextHeaders());
});

/** Role gate helper — throws a Response when the caller lacks the required role. */
export function requireRole(ctx: TenantContext, roles: string[]): Response | null {
  if (!roles.includes(ctx.role)) return fail("insufficient role", 403);
  return null;
}
