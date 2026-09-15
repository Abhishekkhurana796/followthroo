/**
 * Plans, limits, top-ups and what credits cost — the one place any of it is
 * written down.
 *
 * The pricing page, Billing & credits, llms.txt, the FAQ and every limit check
 * read from here. Before this file the tiers lived in three places that
 * disagreed ("Starter $0" on the pricing page, "Free $0" in Billing, "Startup
 * ₹999" in docs/pricing.md), and a number that lives in three places is three
 * numbers.
 *
 * Settled with the client on 2026-09-12, reasoning included. Don't re-derive a
 * price here; change it here when they do.
 */

export type PlanId = "test_drive" | "start" | "grow" | "scale";

export type Feature =
  | "deliverability"
  /** Assigning leads to other people. Start can only own leads itself. */
  | "lead_assignment"
  /** The admin and group-lead roles. */
  | "roles"
  /** Control tower and ageing. */
  | "team_reports"
  /** SLA rules and escalations. */
  | "escalations"
  /** LinkedIn Contact-info email/phone lookup, performed by the desktop app. */
  | "linkedin_enrichment"
  | "premium_ai_models";

export interface Plan {
  id: PlanId;
  name: string;
  /** Whole US dollars. */
  price: number;
  billing: "one_time" | "monthly";
  /** One-time plans only: how many days they last. */
  days?: number;
  blurb: string;
  dailyCredits: number;
  limits: {
    users: number;
    inboxes: number;
    campaigns: number;
    templates: number;
    /** Null means unlimited. */
    leads: number | null;
    autopilots: number;
  };
  features: Feature[];
  /**
   * Whether the plan can buy usage top-ups. Not on the Test Drive: credits that
   * vanish when a 14-day look ends are a refund request waiting to happen.
   */
  topUps: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  test_drive: {
    id: "test_drive",
    name: "Test Drive",
    price: 2,
    billing: "one_time",
    days: 14,
    blurb: "See it work on your own leads before you commit.",
    dailyCredits: 30,
    limits: { users: 1, inboxes: 1, campaigns: 1, templates: 3, leads: 50, autopilots: 0 },
    features: [],
    topUps: false,
  },
  start: {
    id: "start",
    name: "Start",
    price: 10,
    billing: "monthly",
    blurb: "For doing your own outreach, properly.",
    dailyCredits: 100,
    limits: { users: 1, inboxes: 1, campaigns: 3, templates: 10, leads: 500, autopilots: 1 },
    features: ["deliverability"],
    topUps: true,
  },
  grow: {
    id: "grow",
    name: "Grow",
    price: 20,
    billing: "monthly",
    blurb: "For you and a teammate working one pipeline.",
    dailyCredits: 250,
    limits: { users: 2, inboxes: 2, campaigns: 10, templates: 25, leads: 2500, autopilots: 3 },
    features: ["deliverability", "lead_assignment", "roles", "team_reports", "linkedin_enrichment", "premium_ai_models"],
    topUps: true,
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 50,
    billing: "monthly",
    blurb: "For a proper outreach team.",
    dailyCredits: 750,
    limits: { users: 5, inboxes: 5, campaigns: 25, templates: 50, leads: null, autopilots: 10 },
    features: ["deliverability", "lead_assignment", "roles", "team_reports", "escalations", "linkedin_enrichment", "premium_ai_models"],
    topUps: true,
  },
};

export const PLAN_ORDER: PlanId[] = ["test_drive", "start", "grow", "scale"];

/**
 * What every workspace that existed before billing gets: Grow, for 14 days,
 * counted from the first time somebody in it opens the app after launch — so a
 * dormant workspace's trial cannot run out before anyone sees it.
 */
export const LAUNCH_TRIAL = { plan: "grow" as PlanId, days: 14 };

export type CreditAction =
  | "email_send"
  | "li_invite"
  | "li_invite_note"
  | "li_message"
  | "enrich"
  | "whatsapp_send"
  | "sms_send"
  | "ai_draft"
  | "ai_post_standard"
  | "ai_post_premium"
  /** Claude Fable 5.1 only — priced above the other premium models; see lib/posts/models.ts. */
  | "ai_post_fable"
  | "li_sourcing";

/** What each action costs, in credits. */
export const CREDIT_COSTS: Record<CreditAction, number> = {
  email_send: 1,
  li_invite: 3,
  li_invite_note: 5,
  li_message: 2,
  /** The most it can cost; see enrichmentCharge for what it actually does. */
  enrich: 3,
  whatsapp_send: 1,
  sms_send: 1,
  ai_draft: 2,
  ai_post_standard: 10,
  ai_post_premium: 20,
  /**
   * 39, not a rounder number: Fable's real cost is ~$0.077/post, and Scale's
   * own credits are the cheapest a customer ever pays for one (~$0.0022) — the
   * rate a single global credit price has to clear, since every plan shares
   * it. 39 × $0.0022 ≈ $0.0867, over the $0.085 floor even there; Start and
   * Grow customers clear it by more.
   */
  ai_post_fable: 39,
  /** Per ten people imported from LinkedIn by the extension. */
  li_sourcing: 1,
};

/** What importing `people` from LinkedIn with the extension costs. */
export const sourcingCost = (people: number) => Math.ceil(Math.max(0, people) / 10) * CREDIT_COSTS.li_sourcing;

/** Which charge a LinkedIn action is: a message, an invitation, or an invitation with a note. */
export const linkedinCreditAction = (kind: "invite" | "message", withNote: boolean): CreditAction =>
  kind === "message" ? "li_message" : withNote ? "li_invite_note" : "li_invite";

/**
 * What an enrichment costs once its result is known: one for looking, plus one
 * for each of email and phone actually found — so three found both, one found
 * neither. A profile that isn't a 1st-degree connection shows neither to
 * anybody, and a lookup that failed read nothing; both cost nothing.
 */
export function enrichmentCharge(result: { connected: boolean; failed?: boolean; foundEmail: boolean; foundPhone: boolean }) {
  if (result.failed || !result.connected) return 0;
  return 1 + Number(result.foundEmail) + Number(result.foundPhone);
}

export interface TopUpPack {
  id: "pack_500" | "pack_1500" | "pack_5000" | "pack_15000";
  credits: number;
  /** Whole US dollars. */
  price: number;
}

export const TOP_UP_PACKS: TopUpPack[] = [
  { id: "pack_500", credits: 500, price: 5 },
  { id: "pack_1500", credits: 1500, price: 12 },
  { id: "pack_5000", credits: 5000, price: 30 },
  { id: "pack_15000", credits: 15000, price: 75 },
];

/**
 * A plan's credits over its billing period: a month of daily allowance, or the
 * whole Test Drive.
 */
export const periodCredits = (plan: Plan) => plan.dailyCredits * (plan.billing === "one_time" ? plan.days ?? 0 : 30);

/** What one of a plan's own credits costs, in dollars. */
export const planCreditRate = (plan: Plan) => plan.price / periodCredits(plan);

/** What one credit in a pack costs, in dollars. */
export const packCreditRate = (pack: TopUpPack) => pack.price / pack.credits;

/**
 * How many times the plan's own rate a pack costs, to one decimal — the "3.8×
 * your plan" beside each pack. It exists because plans show credits a day and
 * packs show a total, which made a $5 pack look cheaper than a $10 plan when it
 * is three times the price per credit.
 */
export const packVsPlan = (pack: TopUpPack, plan: Plan) => Math.round((packCreditRate(pack) / planCreditRate(plan)) * 10) / 10;

export const hasFeature = (plan: Plan, feature: Feature) => plan.features.includes(feature);

export const planById = (id: string | null | undefined): Plan | null => (id && id in PLANS ? PLANS[id as PlanId] : null);
