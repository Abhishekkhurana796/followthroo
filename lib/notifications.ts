/**
 * Telling people about work that has landed on them.
 *
 * Assignment used to be silent. `createTask` wrote `ownerId` and returned; the
 * only thing that ever reached a person was the due-date reminder in
 * lib/task-reminders.ts — which fires when it is already too late to plan — and
 * the 8am digest. Work could sit on somebody for days before they knew.
 *
 * Two channels, deliberately: the bell, because the person is usually already in
 * the app, and email, because they are often not. Both obey the per-user
 * preferences that already exist at Settings → Notifications.
 */
import { prisma } from "./db";
import { sendSystemEmail } from "./channels/email";
import { readPrefs } from "./task-reminders";

export type NotificationKind = "task_assigned" | "lead_assigned" | "task_due" | "escalation";

export interface NotifyInput {
  organizationId: string;
  /** Recipient. */
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Who caused it. Used only to skip notifying someone about their own action. */
  actorId?: string | null;
  /** Also send an email. The bell alone is enough for low-stakes events. */
  email?: { subject: string; body: string } | null;
  /** Which preference key gates the email half. */
  prefKey?: "taskAssigned" | "leadAssigned";
}

/**
 * Record a notification, and optionally email it.
 *
 * Returns false without writing anything when the recipient is the actor.
 * Notifying you about something you just did yourself is noise, and noise is
 * how people learn to ignore the bell — which costs you the notifications that
 * do matter.
 */
export async function notify(input: NotifyInput): Promise<boolean> {
  if (!input.userId) return false;
  if (input.actorId && input.actorId === input.userId) return false;

  await prisma.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });

  if (input.email) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, notificationPrefs: true },
    });
    // The bell is not opt-out — it is in-app and costs nothing. Email is, because
    // it competes with the person's actual inbox.
    const prefs = readPrefs(user?.notificationPrefs);
    const allowed = input.prefKey ? prefs[input.prefKey] !== false : true;
    if (user?.email && allowed) {
      await sendSystemEmail(user.email, input.email.subject, input.email.body).catch((e) =>
        console.error("[notifications] email failed:", e),
      );
    }
  }
  return true;
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** The bell's payload: recent notifications plus the unread count. */
export async function listNotifications(
  organizationId: string,
  userId: string,
  limit = 30,
): Promise<{ items: NotificationRow[]; unread: number }> {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { organizationId, userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { organizationId, userId, readAt: null } }),
  ]);
  return { items, unread };
}

/**
 * Mark some or all of a person's notifications read.
 *
 * Scoped by userId in the WHERE rather than looked up first, so an id belonging
 * to somebody else silently matches nothing instead of being readable.
 */
export async function markRead(
  organizationId: string,
  userId: string,
  ids?: string[],
): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: {
      organizationId,
      userId,
      readAt: null,
      ...(ids?.length ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return res.count;
}

/**
 * "A contact was assigned to you."
 *
 * Fired from every path that puts a contact on somebody: the auto-assignment
 * rules (lib/assignment.ts), bulk assign on the leads screen, and a manual add
 * routed to someone else. Batched by the caller where several land at once —
 * one email per row of a CSV import would be its own kind of failure.
 */
export async function notifyLeadAssigned(args: {
  organizationId: string;
  userId: string;
  actorId?: string | null;
  leadId: string;
  leadName: string;
  /** More than one at a time collapses into a single "N contacts" message. */
  count?: number;
}): Promise<boolean> {
  const many = (args.count ?? 1) > 1;
  const title = many ? `${args.count} contacts assigned to you` : args.leadName;
  const href = many ? "/dashboard/leads" : `/dashboard/leads/${args.leadId}`;

  return notify({
    organizationId: args.organizationId,
    userId: args.userId,
    actorId: args.actorId ?? null,
    kind: "lead_assigned",
    title,
    body: many ? "They are in your contact list now." : "This contact is now yours to work.",
    href,
    entityType: "lead",
    entityId: args.leadId,
    prefKey: "leadAssigned",
    email: {
      subject: many ? `${args.count} new contacts assigned to you` : `New contact assigned: ${args.leadName}`,
      body: `${title}

Open: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}${href}`,
    },
  });
}
