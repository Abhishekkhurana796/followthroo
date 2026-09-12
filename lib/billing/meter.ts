/**
 * Charging for things, as the rest of the app asks for it.
 *
 * credits.ts keeps the books. This is what a charge means around them: whether
 * billing is on at all, what somebody who can't pay is told, and letting a
 * workspace's admins know when it runs out — so a campaign step, a LinkedIn
 * invitation, an import and the agent all refuse in the same words.
 *
 * Nothing is charged until BILLING_ENFORCED=1, the switch the plan limits use
 * too (./limits.ts). Before launch no workspace has a plan, and a charge against
 * no plan is a refusal: metering switched on early would stop every send.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { orgDayKey } from "../org-day";
import { release, reserve, settle, type CreditRef } from "./credits";
import { billingEnforced } from "./limits";
import type { CreditAction } from "./plans";
import { canSpend, workspacePlan, type WorkspacePlan } from "./subscription";

/** no_credits: a live plan, spent for today · no_plan: no plan, or it has ended. */
export type Refusal = "no_credits" | "no_plan";

export type Charge =
  /** `ref` is null when billing is off and nothing was charged. */
  | { ok: true; ref: CreditRef | null; cost: number }
  | { ok: false; reason: Refusal; message: string; cost: number };

/** Whether a result's reason means "couldn't pay" rather than "failed". */
export const isOutOfCredits = (reason: string | null | undefined): reason is Refusal =>
  reason === "no_credits" || reason === "no_plan";

/**
 * Take the credits for something about to happen, or say why not.
 *
 * Settle every successful charge: `keepCredits` once the thing happened,
 * `returnCredits` once it didn't. A charge nobody settles stays spent.
 */
export async function charge(
  organizationId: string,
  action: CreditAction,
  opts: { ref?: CreditRef; units?: number; cost?: number; meta?: Prisma.InputJsonValue } = {},
): Promise<Charge> {
  if (!billingEnforced()) return { ok: true, ref: null, cost: 0 };
  const ref = opts.ref ?? { type: "send", id: randomUUID() };
  const held = await reserve(organizationId, action, ref, opts);
  if (held.ok) return { ok: true, ref, cost: held.cost };
  return refusal(organizationId, held.cost);
}

/** The ref a charge was made under, or null when nothing was charged. */
export const chargedRef = (paid: Charge | null | undefined) => (paid?.ok ? paid.ref : null);

/**
 * It happened: keep what was reserved, or `keep` of it and hand back the rest.
 * Never throws — whatever it paid for has already happened, and failing now
 * would only get it done twice on a retry.
 */
export async function keepCredits(organizationId: string, ref: CreditRef | null, keep?: number) {
  if (!ref) return;
  await settle(organizationId, ref, keep).catch((e) => console.error(`[billing] could not settle ${ref.type}:${ref.id}:`, e));
}

/** It didn't happen: hand back everything reserved. Never throws. */
export async function returnCredits(organizationId: string, ref: CreditRef | null, reason?: string) {
  if (!ref) return;
  await release(organizationId, ref, reason).catch((e) => console.error(`[billing] could not release ${ref.type}:${ref.id}:`, e));
}

/**
 * Why a workspace can't pay, in words for a person — and, the first time on a
 * given day, an email to its owners and admins. The banner in the app says it
 * on every page; the email is for whoever isn't looking at one.
 */
export async function refusal(organizationId: string, cost: number): Promise<Extract<Charge, { ok: false }>> {
  const wp = await workspacePlan(organizationId);
  if (!canSpend(wp)) {
    const what = !wp.plan
      ? null
      : wp.status === "trialing"
        ? `${wp.plan.name} trial`
        : wp.plan.billing === "one_time"
          ? wp.plan.name
          : `${wp.plan.name} plan`;
    const message = what && wp.access === "expired" ? `Your ${what} has ended. Choose a plan to carry on.` : "Choose a plan to start sending.";
    return { ok: false, reason: "no_plan", message, cost };
  }
  await tellAdminsOutOfCredits(organizationId, wp).catch((e) => console.error("[billing] out-of-credits email failed:", e));
  return {
    ok: false,
    reason: "no_credits",
    cost,
    message: `Out of credits for today. Sending picks up again at midnight in your workspace's time zone. ${
      wp.plan?.topUps ? "Need more today? Buy credits under Billing." : "Upgrade for a bigger daily allowance."
    }`,
  };
}

async function tellAdminsOutOfCredits(organizationId: string, wp: WorkspacePlan) {
  if (!(await once(`credits-out:${organizationId}:${await orgDayKey(organizationId)}`, "notice.credits_out"))) return;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const name = org?.name ?? "Your workspace";
  const link = `${env.appUrl}/dashboard/settings/billing`;
  await emailAdmins(
    organizationId,
    `${name} is out of credits for today`,
    [
      `${name} has used today's credits, so campaign emails, LinkedIn invitations and AI drafts are waiting.`,
      "",
      "Nothing is lost. Everything waiting carries on at midnight in your workspace's time zone.",
      "",
      wp.plan?.topUps ? `Need more today? Buy credits: ${link}` : `Upgrade for a bigger daily allowance: ${link}`,
    ].join("\n"),
  );
}

/** Email a workspace's owners and admins through the platform mailbox. Returns how many went. */
export async function emailAdmins(organizationId: string, subject: string, body: string) {
  // Imported when needed: the email channel sits on the send path, which charges through this file.
  const { sendSystemEmail } = await import("../channels/email");
  const admins = await prisma.member.findMany({
    where: { organizationId, role: { in: ["owner", "admin"] } },
    select: { user: { select: { email: true } } },
  });
  let sent = 0;
  for (const m of admins) if (m.user.email && (await sendSystemEmail(m.user.email, subject, body))) sent++;
  return sent;
}

/**
 * True the first time a key is seen, false every time after — for anything that
 * must happen once however often it's triggered, like a notice. Uses
 * BillingEvent's unique id, the same table that makes Razorpay webhooks
 * idempotent, rather than a flag column for every kind of notice.
 */
export async function once(key: string, type: string) {
  const inserted = await prisma.$executeRaw(
    Prisma.sql`INSERT INTO "BillingEvent" ("id", "type", "createdAt") VALUES (${key}, ${type}, now()) ON CONFLICT ("id") DO NOTHING`,
  );
  return inserted > 0;
}
