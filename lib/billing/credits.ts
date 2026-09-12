/**
 * Credits: the daily allowance, top-ups, and every charge against them.
 *
 * Three rules shape everything in this file.
 *
 *  1. The balance can never go negative. A charge is one conditional UPDATE that
 *     only succeeds if the credits are there — never a read followed by a write.
 *     `claimActions` has exactly that read-then-write race, and two workers
 *     spending a workspace's last ten credits twice is the same bug with money.
 *  2. Credits are reserved when something starts and settled when it finishes:
 *     kept when it happened, handed back when it didn't. Nobody pays for a
 *     failed send, and enrichment pays only for what it found.
 *  3. Every movement is a CreditLedger row, unique per thing, kind and bucket,
 *     and each thing is locked while it moves — so a retry, a double click or a
 *     redelivered webhook cannot move credits twice.
 *
 * Today's allowance is spent before top-ups, and it is granted lazily: the first
 * credit operation of a workspace-local day tops the allowance up to the plan's
 * figure. Nothing has to run at midnight, and a workspace nobody touches never
 * accrues anything.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { dayKeyAt, orgOffsetMinutes } from "../org-day";
import { CREDIT_COSTS, planById, type CreditAction } from "./plans";

/**
 * The client a transaction callback receives. Derived from `prisma` rather than
 * Prisma.TransactionClient: lib/db.ts extends the client with column
 * encryption, and the plain type no longer matches the extended one.
 */
type Tx = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use">;

/** What credits were spent on: `{ type: "linkedin_action", id }`, `{ type: "message", id }`… */
export interface CreditRef {
  type: string;
  id: string;
}

type Bucket = "daily" | "topup";

/**
 * Transaction headroom.
 *
 * Prisma's defaults — two seconds to start, five to finish — are shorter than a
 * handful of round trips to the database pooler from a server on another
 * continent. A charge that runs out of time is rolled back, which is safe, but
 * it is still a failure for something that did nothing wrong. So the reads a
 * charge needs happen before its transaction opens, and only the writes run
 * inside it, with room to spare.
 */
const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

/** Subscription statuses that still earn a daily allowance. */
const LIVE = new Set(["trialing", "active", "past_due"]);

/** A workspace's daily allowance: its plan's, or nothing without a live plan. */
export async function dailyAllowance(organizationId: string, db: Tx | typeof prisma = prisma) {
  const sub = await db.subscription.findUnique({
    where: { organizationId },
    select: { planId: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  if (!sub || !LIVE.has(sub.status)) return 0;
  const now = new Date();
  if (sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt < now) return 0;
  const plan = planById(sub.planId);
  // The Test Drive is paid once and runs out; nothing renews it.
  if (plan?.billing === "one_time" && sub.currentPeriodEnd && sub.currentPeriodEnd < now) return 0;
  return plan?.dailyCredits ?? 0;
}

/** One ledger row. False when that exact row already exists — it was a repeat. */
async function writeLedger(
  tx: Tx,
  organizationId: string,
  row: { kind: string; amount: number; bucket: Bucket; action?: string | null; ref: CreditRef; meta?: Prisma.InputJsonValue },
) {
  const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "CreditLedger" ("id", "organizationId", "kind", "amount", "bucket", "action", "refType", "refId", "meta", "createdAt")
    VALUES (${randomUUID()}, ${organizationId}, ${row.kind}, ${row.amount}, ${row.bucket}, ${row.action ?? null},
            ${row.ref.type}, ${row.ref.id}, ${JSON.stringify(row.meta ?? {})}::jsonb, now())
    ON CONFLICT ("refType", "refId", "kind", "bucket") DO NOTHING
    RETURNING "id"`);
  return inserted.length > 0;
}

/** Serialise everything that touches one charged thing, for this transaction. */
async function lockRef(tx: Tx, ref: CreditRef) {
  // Wrapped in a subquery: pg_advisory_xact_lock returns void, which Prisma
  // cannot read back as a column.
  await tx.$queryRaw(
    Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`credits:${ref.type}:${ref.id}`}))) AS l`,
  );
}

/** What opening the day needs, read before any transaction starts. */
async function dayContext(organizationId: string) {
  const [offset, allowance] = await Promise.all([orgOffsetMinutes(organizationId), dailyAllowance(organizationId)]);
  return { offset, today: dayKeyAt(offset), allowance };
}
type DayContext = Awaited<ReturnType<typeof dayContext>>;

/**
 * Make sure the balance row exists and today's allowance has been granted.
 *
 * Safe to race: the grant only happens where the stored day differs from today,
 * so two callers opening the same day grant it once.
 */
async function openDay(tx: Tx, organizationId: string, day: DayContext) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "CreditBalance" ("organizationId", "dailyRemaining", "dailyDate", "topupRemaining", "updatedAt")
    VALUES (${organizationId}, 0, '', 0, now())
    ON CONFLICT ("organizationId") DO NOTHING`);
  const granted = await tx.$executeRaw(Prisma.sql`
    UPDATE "CreditBalance" SET "dailyRemaining" = ${day.allowance}::int, "dailyDate" = ${day.today}, "updatedAt" = now()
    WHERE "organizationId" = ${organizationId} AND "dailyDate" <> ${day.today}`);
  if (granted > 0 && day.allowance > 0) {
    await writeLedger(tx, organizationId, {
      kind: "grant",
      amount: day.allowance,
      bucket: "daily",
      ref: { type: "day", id: `${organizationId}:${day.today}` },
    });
  }
}

export type Reservation =
  | { ok: true; cost: number; fromDaily: number; fromTopup: number }
  | { ok: false; reason: "no_credits"; cost: number; available: number };

/**
 * Hold credits for something about to happen.
 *
 * Taken from today's allowance first, then from top-ups, in a single conditional
 * UPDATE: if the credits are not all there, nothing is taken and `ok` is false.
 * Reserving the same thing again returns the first reservation instead of
 * charging twice — even after that reservation was settled, so anything that
 * can be tried again once it has finished needs a ref for each attempt.
 */
export async function reserve(
  organizationId: string,
  action: CreditAction,
  ref: CreditRef,
  opts: { units?: number; cost?: number; meta?: Prisma.InputJsonValue } = {},
): Promise<Reservation> {
  const cost = opts.cost ?? CREDIT_COSTS[action] * (opts.units ?? 1);
  if (cost <= 0) return { ok: true, cost: 0, fromDaily: 0, fromTopup: 0 };
  const day = await dayContext(organizationId);

  return prisma.$transaction(async (tx) => {
    await lockRef(tx, ref);
    await openDay(tx, organizationId, day);

    const prior = await tx.creditLedger.findMany({
      where: { organizationId, refType: ref.type, refId: ref.id, kind: "reserve" },
      select: { amount: true, bucket: true },
    });
    if (prior.length) {
      const fromDaily = -prior.filter((p) => p.bucket === "daily").reduce((s, p) => s + p.amount, 0);
      const fromTopup = -prior.filter((p) => p.bucket === "topup").reduce((s, p) => s + p.amount, 0);
      return { ok: true as const, cost: fromDaily + fromTopup, fromDaily, fromTopup };
    }

    // Postgres evaluates every SET expression against the row as it was, so the
    // split below is computed from the same starting balance on both sides.
    const taken = await tx.$queryRaw<{ fromDaily: number; fromTopup: number }[]>(Prisma.sql`
      WITH old AS (
        SELECT "dailyRemaining" AS d, "topupRemaining" AS t
        FROM "CreditBalance" WHERE "organizationId" = ${organizationId}
        FOR UPDATE
      )
      UPDATE "CreditBalance" AS b
      SET "dailyRemaining" = old.d - LEAST(old.d, ${cost}::int),
          "topupRemaining" = old.t - (${cost}::int - LEAST(old.d, ${cost}::int)),
          "updatedAt" = now()
      FROM old
      WHERE b."organizationId" = ${organizationId} AND old.d + old.t >= ${cost}::int
      RETURNING LEAST(old.d, ${cost}::int)::int AS "fromDaily",
                (${cost}::int - LEAST(old.d, ${cost}::int))::int AS "fromTopup"`);

    if (!taken.length) {
      const bal = await tx.creditBalance.findUnique({ where: { organizationId } });
      return {
        ok: false as const,
        reason: "no_credits" as const,
        cost,
        available: (bal?.dailyRemaining ?? 0) + (bal?.topupRemaining ?? 0),
      };
    }

    const { fromDaily, fromTopup } = taken[0];
    if (fromDaily) await writeLedger(tx, organizationId, { kind: "reserve", amount: -fromDaily, bucket: "daily", action, ref, meta: opts.meta });
    if (fromTopup) await writeLedger(tx, organizationId, { kind: "reserve", amount: -fromTopup, bucket: "topup", action, ref, meta: opts.meta });
    return { ok: true as const, cost, fromDaily, fromTopup };
  }, TX_OPTIONS);
}

/**
 * Finish a reservation: keep `keep` credits of it and hand the rest back.
 *
 * `keep` defaults to all of it — the thing happened. Anything handed back goes
 * to the bucket it came from, top-ups first; a daily credit reserved on an
 * earlier day comes back as a top-up rather than vanishing, because the
 * customer paid for something that did not happen and today's allowance has
 * already been reset. Settling the same thing twice changes nothing.
 */
export async function settle(organizationId: string, ref: CreditRef, keep?: number, reason?: string) {
  const offset = await orgOffsetMinutes(organizationId);

  return prisma.$transaction(async (tx) => {
    await lockRef(tx, ref);
    const rows = await tx.creditLedger.findMany({ where: { organizationId, refType: ref.type, refId: ref.id } });
    const reserved = rows.filter((r) => r.kind === "reserve");
    if (!reserved.length || rows.some((r) => r.kind === "capture" || r.kind === "release" || r.kind === "refund")) {
      return { kept: 0, returned: 0, repeat: reserved.length > 0 };
    }

    const fromDaily = -reserved.filter((r) => r.bucket === "daily").reduce((s, r) => s + r.amount, 0);
    const fromTopup = -reserved.filter((r) => r.bucket === "topup").reduce((s, r) => s + r.amount, 0);
    const total = fromDaily + fromTopup;
    const kept = Math.max(0, Math.min(total, keep ?? total));
    const back = total - kept;
    const action = reserved[0].action;

    if (back === 0) {
      await writeLedger(tx, organizationId, { kind: "capture", amount: 0, bucket: reserved[0].bucket as Bucket, action, ref, meta: { kept } });
      return { kept, returned: 0, repeat: false };
    }

    const kind = kept === 0 ? "release" : "refund";
    const topupBack = Math.min(back, fromTopup);
    const dailyBack = back - topupBack;
    const sameDay = dayKeyAt(offset, reserved[0].createdAt) === dayKeyAt(offset);
    const toDaily = sameDay ? dailyBack : 0;
    const toTopup = topupBack + (sameDay ? 0 : dailyBack);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "CreditBalance"
      SET "dailyRemaining" = "dailyRemaining" + ${toDaily}::int,
          "topupRemaining" = "topupRemaining" + ${toTopup}::int,
          "updatedAt" = now()
      WHERE "organizationId" = ${organizationId}`);
    const meta = { kept, reason: reason ?? null };
    if (toDaily) await writeLedger(tx, organizationId, { kind, amount: toDaily, bucket: "daily", action, ref, meta });
    if (toTopup) await writeLedger(tx, organizationId, { kind, amount: toTopup, bucket: "topup", action, ref, meta });
    return { kept, returned: toDaily + toTopup, repeat: false };
  }, TX_OPTIONS);
}

/** It didn't happen: hand every reserved credit back. */
export const release = (organizationId: string, ref: CreditRef, reason?: string) => settle(organizationId, ref, 0, reason);

/** Today's picture for a workspace, opening the day if nobody has yet. */
export async function balance(organizationId: string) {
  const day = await dayContext(organizationId);
  return prisma.$transaction(async (tx) => {
    await openDay(tx, organizationId, day);
    const bal = await tx.creditBalance.findUnique({ where: { organizationId } });
    return {
      day: day.today,
      dailyAllowance: day.allowance,
      dailyRemaining: bal?.dailyRemaining ?? 0,
      topupRemaining: bal?.topupRemaining ?? 0,
    };
  }, TX_OPTIONS);
}

/**
 * What a workspace could spend right now, without writing anything.
 *
 * For deciding ahead — which queued invitations today's credits cover, how much
 * of an import fits — where opening the day in a transaction on every look would
 * be a write for a read. A day nobody has opened yet counts its allowance as
 * granted, because the first charge will grant it.
 */
export async function spendable(organizationId: string) {
  const [day, bal] = await Promise.all([dayContext(organizationId), prisma.creditBalance.findUnique({ where: { organizationId } })]);
  const daily = bal && bal.dailyDate === day.today ? bal.dailyRemaining : day.allowance;
  const topup = bal?.topupRemaining ?? 0;
  return { daily, topup, total: daily + topup };
}

/** Which of these things still hold credits that were reserved and not yet settled. */
export async function unsettled(organizationId: string, refType: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await prisma.creditLedger.findMany({
    where: { organizationId, refType, refId: { in: ids } },
    select: { refId: true, kind: true },
  });
  const settled = new Set(rows.filter((r) => r.kind !== "reserve").map((r) => r.refId));
  return new Set(rows.filter((r) => r.kind === "reserve" && !settled.has(r.refId)).map((r) => r.refId));
}

/**
 * Credit a paid top-up. Keyed on the purchase, so a payment webhook delivered
 * twice credits once.
 */
export async function addTopup(organizationId: string, purchaseId: string, credits: number) {
  const day = await dayContext(organizationId);
  return prisma.$transaction(async (tx) => {
    const ref = { type: "purchase", id: purchaseId };
    await lockRef(tx, ref);
    await openDay(tx, organizationId, day);
    const fresh = await writeLedger(tx, organizationId, { kind: "topup", amount: credits, bucket: "topup", ref });
    if (fresh) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CreditBalance" SET "topupRemaining" = "topupRemaining" + ${credits}::int, "updatedAt" = now()
        WHERE "organizationId" = ${organizationId}`);
    }
    return fresh;
  }, TX_OPTIONS);
}
