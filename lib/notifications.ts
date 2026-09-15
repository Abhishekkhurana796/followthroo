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
import { sendSystemEmailDetailed } from "./channels/email";
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
 * What one dispatch actually did — every branch, named.
 *
 * The email half used to be a fire-and-forget call whose result was thrown
 * away: `sendSystemEmail(...).catch(console.error)`. So "the bell arrived but
 * no email did" had six indistinguishable explanations — no address on the
 * user, the preference off, SMTP unconfigured on that deployment, the
 * transport rejecting the credentials, the actor being the recipient, or the
 * notification never being raised at all — and nothing anywhere said which.
 * That is the actual defect behind "I was never emailed about my task": not a
 * wrong line, an invisible one.
 */
export interface NotifyResult {
  /** Whether the bell row was written. */
  notified: boolean;
  /** Why it wasn't, when it wasn't. */
  skipped?: "no_recipient" | "self_action";
  recipientId: string;
  recipientEmail: string | null;
  /** Did the caller ask for an email at all? */
  emailRequested: boolean;
  /** Did the recipient's preferences permit it? */
  preferenceAllowed: boolean;
  /** Did we get as far as handing it to SMTP? */
  emailAttempted: boolean;
  emailSent: boolean;
  emailError?: string;
}

/**
 * Record a notification, and optionally email it.
 *
 * Writes nothing when the recipient is the actor. Notifying you about
 * something you just did yourself is noise, and noise is how people learn to
 * ignore the bell — which costs you the notifications that do matter.
 *
 * Mail delivery never throws: the caller receives a structured failure instead.
 * Database failures still surface to the caller, whose task/lead write path is
 * responsible for treating the notification itself as best-effort.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const base: NotifyResult = {
    notified: false,
    recipientId: input.userId,
    recipientEmail: null,
    emailRequested: !!input.email,
    preferenceAllowed: false,
    emailAttempted: false,
    emailSent: false,
  };
  if (!input.userId) return { ...base, skipped: "no_recipient" };
  if (input.actorId && input.actorId === input.userId) return { ...base, skipped: "self_action" };

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

  const result: NotifyResult = { ...base, notified: true };

  if (input.email) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, notificationPrefs: true },
    });
    // The bell is not opt-out — it is in-app and costs nothing. Email is, because
    // it competes with the person's actual inbox.
    const prefs = readPrefs(user?.notificationPrefs);
    result.recipientEmail = user?.email ?? null;
    result.preferenceAllowed = input.prefKey ? prefs[input.prefKey] !== false : true;
    result.emailAttempted = !!user?.email && result.preferenceAllowed;

    if (result.emailAttempted) {
      const sent = await sendSystemEmailDetailed(user!.email, input.email.subject, input.email.body).catch((e) => ({
        sent: false as const,
        reason: "send_failed" as const,
        error: String((e as Error)?.message ?? e).slice(0, 300),
      }));
      result.emailSent = sent.sent;
      if (!sent.sent) result.emailError = sent.reason === "not_configured" ? "not_configured" : (sent.error ?? sent.reason);
    }
  }

  // One line per dispatch, so an undelivered email can be diagnosed from the
  // logs alone instead of by reasoning about which branch might have run.
  console.log(
    JSON.stringify({
      event: `${input.kind.toUpperCase()}_NOTIFICATION`,
      kind: input.kind,
      organizationId: input.organizationId,
      recipientId: result.recipientId,
      recipientEmail: result.recipientEmail,
      emailRequested: result.emailRequested,
      preferenceAllowed: result.preferenceAllowed,
      emailAttempted: result.emailAttempted,
      emailSent: result.emailSent,
      ...(result.emailError ? { emailError: result.emailError } : {}),
    }),
  );

  return result;
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

/** Unread notifications waiting in one of the person's other workspaces. */
export interface ElsewhereRow {
  organizationId: string;
  name: string;
  unread: number;
}

/**
 * The bell's payload: recent notifications, the unread count, and unread counts
 * from the person's other workspaces.
 *
 * `elsewhere` exists because a notification is scoped to the workspace it was
 * raised in, and the bell only reads the active one. A teammate signed in to the
 * wrong workspace — which every invited teammate was, until lib/auth.ts stopped
 * defaulting to the oldest membership — saw an empty bell while their tasks sat
 * one switch away. That should never again look like "nobody told me".
 */
export async function listNotifications(
  organizationId: string,
  userId: string,
  limit = 30,
): Promise<{ items: NotificationRow[]; unread: number; elsewhere: ElsewhereRow[] }> {
  const [items, unread, others] = await Promise.all([
    prisma.notification.findMany({
      where: { organizationId, userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { organizationId, userId, readAt: null } }),
    prisma.notification.groupBy({
      by: ["organizationId"],
      where: { userId, readAt: null, organizationId: { not: organizationId } },
      _count: { _all: true },
    }),
  ]);

  // Only workspaces they still belong to: a removed member's old notifications
  // would otherwise offer a Switch that setActive then refuses.
  const orgs = others.length
    ? await prisma.organization.findMany({
        where: { id: { in: others.map((o) => o.organizationId) }, members: { some: { userId } } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  const elsewhere = others
    .filter((o) => nameById.has(o.organizationId))
    .map((o) => ({ organizationId: o.organizationId, name: nameById.get(o.organizationId)!, unread: o._count._all }));

  return { items, unread, elsewhere };
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
}): Promise<NotifyResult> {
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
