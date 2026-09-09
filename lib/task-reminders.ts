/**
 * Task reminders, overdue nudges, and escalation.
 *
 * Before this, a task's due date did nothing at all: "overdue" was a query
 * scope, so a task went red on a screen nobody had open. The machinery to fix
 * that already existed for pipeline items — `sweepSlaBreaches` finds late work,
 * walks the manager chain and emails — so this deliberately mirrors its shape
 * rather than inventing a second one.
 *
 * Three things fire, each at most once per task:
 *
 *   1. `remindedAt`  — the owner, when the task comes due.
 *   2. `escalatedAt` — their manager, if it is still open a grace period later.
 *   3. the daily digest — everything on someone's plate, once each morning.
 *
 * Every one is guarded by a null timestamp, because the sweep runs every 15
 * minutes and the alternative is emailing somebody ninety-six times a day.
 */
import { prisma } from "./db";
import { sendSystemEmail } from "./channels/email";
import { getTaskBuckets, startOfToday, taskLabel } from "./tasks";
import { getBusinessHours } from "./notify";
import { env } from "./env";

/** How long a task sits overdue before the manager hears about it. */
const ESCALATE_AFTER_MS = 24 * 60 * 60_000;

/** Local hour the morning digest goes out, in the org's own timezone. */
const DIGEST_HOUR = 8;

export type NotificationPrefs = {
  taskReminders: boolean;
  dailyDigest: boolean;
  /** Email when a task is assigned to you (the in-app bell is not opt-out). */
  taskAssigned: boolean;
  /** Email when a contact is assigned or routed to you. */
  leadAssigned: boolean;
};

/** Null prefs means a user who has never opened the settings — default to on. */
export function readPrefs(raw: unknown): NotificationPrefs {
  const p = (raw ?? {}) as Partial<NotificationPrefs>;
  return {
    taskReminders: p.taskReminders !== false,
    dailyDigest: p.dailyDigest !== false,
    taskAssigned: p.taskAssigned !== false,
    leadAssigned: p.leadAssigned !== false,
  };
}

type Recipient = { id: string; email: string; name: string | null; notificationPrefs: unknown };

async function recipient(userId: string | null): Promise<Recipient | null> {
  if (!userId) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, notificationPrefs: true },
  });
}

function taskUrl(leadId: string | null): string {
  return leadId ? `${env.appUrl}/dashboard/leads/${leadId}` : `${env.appUrl}/dashboard/tasks`;
}

// ---- 1 + 2: the sweep -----------------------------------------------------

/**
 * Nudge owners whose tasks have come due, then escalate the ones still open a
 * day later. Safe to run repeatedly — both stages claim their row with a
 * guarded `updateMany` before sending, so two overlapping sweeps cannot double
 * up on the same task.
 */
export async function sweepTaskReminders(limit = 200): Promise<{
  reminded: number;
  escalated: number;
}> {
  const now = new Date();
  let reminded = 0;
  let escalated = 0;

  // -- due now, owner not yet told --------------------------------------
  const due = await prisma.task.findMany({
    where: { status: "open", dueAt: { not: null, lte: now }, remindedAt: null, ownerId: { not: null } },
    select: { id: true, title: true, dueAt: true, ownerId: true, leadId: true, organizationId: true },
    take: limit,
    orderBy: { dueAt: "asc" },
  });

  for (const t of due) {
    // Resolve the recipient BEFORE claiming. Someone who has opted out, or has
    // no email, must not have the task marked reminded — otherwise switching
    // reminders back on would never surface the work already skipped.
    const user = await recipient(t.ownerId);
    if (!user?.email || !readPrefs(user.notificationPrefs).taskReminders) continue;

    // Claim, so two overlapping sweeps cannot both send.
    const claimed = await prisma.task.updateMany({
      where: { id: t.id, remindedAt: null },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;

    const sent = await sendSystemEmail(
      user.email,
      `Due now: ${t.title}`,
      [
        `${t.title} is due.`,
        "",
        taskUrl(t.leadId),
      ].join("\n"),
    ).catch(() => false);

    if (sent) {
      reminded++;
    } else {
      // Release the claim. A transient SMTP failure must not consume the single
      // reminder this task gets — the whole point is that nothing falls through.
      await prisma.task.updateMany({
        where: { id: t.id, remindedAt: now },
        data: { remindedAt: null },
      });
    }
  }

  // -- overdue past the grace period, manager not yet told ---------------
  const stale = new Date(now.getTime() - ESCALATE_AFTER_MS);
  const late = await prisma.task.findMany({
    where: {
      status: "open",
      dueAt: { not: null, lt: stale },
      escalatedAt: null,
      ownerId: { not: null },
    },
    select: { id: true, title: true, dueAt: true, ownerId: true, leadId: true, organizationId: true },
    take: limit,
    orderBy: { dueAt: "asc" },
  });

  for (const t of late) {
    const claimed = await prisma.task.updateMany({
      where: { id: t.id, escalatedAt: null },
      data: { escalatedAt: now },
    });
    if (claimed.count === 0) continue;

    const manager = await prisma.member.findFirst({
      where: { organizationId: t.organizationId, userId: t.ownerId! },
      select: { manager: { select: { userId: true } } },
    });
    const toUserId = manager?.manager?.userId ?? null;

    const channels: string[] = [];
    let reason: string | undefined = toUserId ? undefined : "no manager on file to escalate to";
    if (toUserId) {
      const target = await recipient(toUserId);
      if (!target?.email) reason = "manager has no email address";
      if (target?.email) {
        const owner = await recipient(t.ownerId);
        const who = owner?.name || owner?.email || "someone on your team";
        const sent = await sendSystemEmail(
          target.email,
          `Overdue task: ${t.title}`,
          [
            `"${t.title}" was due ${t.dueAt?.toLocaleString() ?? "earlier"} and is still open.`,
            `Owner: ${who}`,
            "",
            taskUrl(t.leadId),
          ].join("\n"),
        ).catch(() => false);
        if (sent) channels.push("email");
        else reason = "email could not be sent - check the platform mailbox";
      }
    }

    // Recorded either way, including when nothing was delivered — the
    // Escalations screen reports honestly on that, and a silent gap would let
    // "no manager on file" look like a working escalation.
    await prisma.escalationEvent.create({
      data: {
        organizationId: t.organizationId,
        taskId: t.id,
        level: toUserId ? 2 : 1,
        toUserId,
        channel: channels[0] ?? "in_app",
        meta: { channels, reason },
      },
    });
    escalated++;
  }

  return { reminded, escalated };
}

// ---- 3: the daily digest --------------------------------------------------

/** What is on this person's plate. Null when there is nothing — an empty digest is spam. */
export async function buildDigest(
  organizationId: string,
  userId: string,
): Promise<{ subject: string; body: string } | null> {
  const { overdue, today } = await getTaskBuckets(organizationId, userId);
  if (overdue.length === 0 && today.length === 0) return null;

  const lines: string[] = [];
  if (overdue.length) {
    lines.push(`Overdue (${overdue.length})`);
    for (const t of overdue) lines.push(`  - ${taskLabel(t)}`);
    lines.push("");
  }
  if (today.length) {
    lines.push(`Today (${today.length})`);
    for (const t of today) lines.push(`  - ${taskLabel(t)}`);
    lines.push("");
  }
  lines.push(`${env.appUrl}/dashboard/tasks`);

  const total = overdue.length + today.length;
  return {
    subject: `${total} thing${total === 1 ? "" : "s"} to chase today`,
    body: lines.join("\n"),
  };
}

/**
 * The org's current local hour.
 *
 * Same trick lib/notify.ts uses: shift the epoch by the declared offset and read
 * it back with getUTC*, so the server's own timezone never enters the sum.
 */
function localHour(businessHours: unknown): number {
  const hours = getBusinessHours(businessHours);
  return new Date(Date.now() + hours.timezoneOffsetMinutes * 60_000).getUTCHours();
}

/**
 * Send each member their morning digest.
 *
 * Runs hourly and picks the orgs whose *local* time has just reached 8am, rather
 * than firing at 8am server time — which on Vercel is UTC, i.e. half past one in
 * the afternoon in India.
 */
export async function sweepDailyDigests(): Promise<{ sent: number; orgs: number }> {
  const orgs = await prisma.organization.findMany({ select: { id: true, businessHours: true } });
  let sent = 0;
  let considered = 0;

  for (const org of orgs) {
    if (localHour(org.businessHours) !== DIGEST_HOUR) continue;
    considered++;

    const members = await prisma.member.findMany({
      where: { organizationId: org.id },
      select: { userId: true },
    });

    for (const m of members) {
      const user = await recipient(m.userId);
      if (!user?.email || !readPrefs(user.notificationPrefs).dailyDigest) continue;

      // One a day, whatever happens — the hourly cadence would otherwise send
      // one an hour for the whole hour the local clock reads 8.
      const alreadyToday = await prisma.user.count({
        where: { id: user.id, lastDigestAt: { gte: startOfToday() } },
      });
      if (alreadyToday > 0) continue;

      const digest = await buildDigest(org.id, m.userId);
      if (!digest) continue;

      await prisma.user.update({ where: { id: user.id }, data: { lastDigestAt: new Date() } });
      const ok = await sendSystemEmail(user.email, digest.subject, digest.body).catch(() => false);
      if (ok) sent++;
    }
  }

  return { sent, orgs: considered };
}
