/**
 * Plan limits: how many people, inboxes, campaigns, templates and leads a
 * workspace can have, and which features it gets.
 *
 * Checked where things are created, not by hiding a button. A limit only the UI
 * knows about is a limit any API client, the agent or an import walks straight
 * past.
 *
 * Off until BILLING_ENFORCED=1. Every workspace that exists today has no
 * Subscription row until the launch migration gives it one, and a check that
 * reads "no plan" as "a limit of zero" would stop all of them creating anything
 * the moment this deploys. Until then the checks run and report, and allow.
 */
import { prisma } from "../db";
import { fail } from "../http";
import { hasFeature, type Feature, type Plan } from "./plans";
import { workspacePlan } from "./subscription";

export type LimitKey = "users" | "inboxes" | "campaigns" | "templates" | "leads" | "autopilots";

export const billingEnforced = () => process.env.BILLING_ENFORCED === "1";

const NOUN: Record<LimitKey, [one: string, many: string]> = {
  users: ["person", "people"],
  inboxes: ["sending inbox", "sending inboxes"],
  campaigns: ["campaign", "campaigns"],
  templates: ["template", "templates"],
  leads: ["lead", "leads"],
  autopilots: ["post autopilot", "post autopilots"],
};

/** What a workspace currently has of each limited thing. */
async function countOf(organizationId: string, key: LimitKey): Promise<number> {
  switch (key) {
    // A person made read-only to fit the plan no longer takes a seat. Null is
    // active — the column is nullable, like every app column on better-auth's tables.
    case "users":
      return prisma.member.count({ where: { organizationId, OR: [{ seatActive: null }, { seatActive: true }] } });
    case "inboxes":
      return prisma.sendingAccount.count({ where: { organizationId, active: true } });
    case "campaigns":
      return prisma.campaign.count({ where: { organizationId, archivedAt: null } });
    case "templates":
      return prisma.template.count({ where: { organizationId, archivedAt: null } });
    case "leads":
      return prisma.lead.count({ where: { organizationId } });
    case "autopilots":
      // Posts arrive in P3; nothing to count yet.
      return 0;
  }
}

/** The limits Billing shows. Post autopilots join when Posts ships. */
const SHOWN_LIMITS: LimitKey[] = ["users", "inboxes", "campaigns", "templates", "leads"];

/** How much of each limit a workspace uses, against its plan. A null limit is unlimited. */
export async function limitUsage(organizationId: string) {
  const [wp, counts] = await Promise.all([
    workspacePlan(organizationId),
    Promise.all(SHOWN_LIMITS.map((key) => countOf(organizationId, key))),
  ]);
  return SHOWN_LIMITS.map((key, i) => ({ key, used: counts[i], limit: wp.plan ? wp.plan.limits[key] : 0 }));
}

export type LimitCheck =
  | { ok: true; used: number; limit: number | null }
  | { ok: false; used: number; limit: number; plan: Plan | null; message: string };

/** Can this workspace add `adding` more of `key` under its plan? */
export async function checkLimit(organizationId: string, key: LimitKey, adding = 1): Promise<LimitCheck> {
  const [wp, used] = await Promise.all([workspacePlan(organizationId), countOf(organizationId, key)]);
  const limit = wp.plan ? wp.plan.limits[key] : 0;
  if (limit === null || used + adding <= limit) return { ok: true, used, limit };

  const [one, many] = NOUN[key];
  const message = !wp.plan
    ? `Choose a plan to add ${many}.`
    : `Your ${wp.plan.name} plan includes ${limit} ${limit === 1 ? one : many}, and you have ${used}. Upgrade to add more.`;
  return { ok: false, used, limit, plan: wp.plan, message };
}

/**
 * For route handlers: a 402 with a plain sentence when the plan is full, or null
 * to carry on. Always null while billing is not enforced, but the refusal it
 * would have given is logged, so the launch is not the first time anyone sees it.
 */
export async function requireLimit(organizationId: string, key: LimitKey, adding = 1): Promise<Response | null> {
  const check = await checkLimit(organizationId, key, adding);
  if (check.ok) return null;
  if (!billingEnforced()) {
    console.info(`[limits] would refuse ${key} for ${organizationId}: ${check.message}`);
    return null;
  }
  return fail(check.message, 402);
}

/** How many more of `key` fit — for imports, which add many at once. Infinity when unlimited or not enforced. */
export async function roomFor(organizationId: string, key: LimitKey): Promise<number> {
  if (!billingEnforced()) return Number.POSITIVE_INFINITY;
  const [wp, used] = await Promise.all([workspacePlan(organizationId), countOf(organizationId, key)]);
  const limit = wp.plan ? wp.plan.limits[key] : 0;
  return limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
}

/** For route handlers: a 402 when the plan lacks a feature, or null to carry on. */
export async function requireFeature(organizationId: string, feature: Feature, label: string): Promise<Response | null> {
  if (!billingEnforced()) return null;
  const wp = await workspacePlan(organizationId);
  if (wp.plan && hasFeature(wp.plan, feature)) return null;
  return fail(`${label} isn't included in ${wp.plan ? `the ${wp.plan.name} plan` : "your workspace yet"}. Upgrade to use it.`, 402);
}
