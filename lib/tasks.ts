/**
 * Next action — the one thing the product promises to remember for you.
 *
 * Every active contact should be able to answer "what do I do next?" without the
 * rep holding it in their head. Two sources feed that answer:
 *
 *   1. An explicit `Task` — a rep scheduled it, or the system created one when a
 *      reply landed.
 *   2. A DERIVED action, computed from state the app already has (an unanswered
 *      inbound message, a breached SLA, a lead nobody has contacted yet).
 *
 * The derivation matters more than it looks: without it the Next Action column is
 * empty on day one for every existing contact, and a CRM whose headline feature is
 * blank until you feed it is the same CRM everyone already abandoned. Derived
 * actions need no setup — they are a reading of the data, not a record.
 */
import { prisma } from "./db";
import type { Department, Prisma, TaskKind, TaskPriority, TaskStatus } from "@prisma/client";

/** What the UI renders in a Next Action slot. */
export type NextAction = {
  /** Present only for a real Task — derived actions have nothing to complete. */
  taskId: string | null;
  label: string;
  kind: TaskKind;
  dueAt: Date | null;
  /** Overdue tasks and breached SLAs; drives the red treatment. */
  urgent: boolean;
  /** "task" when a row backs it, otherwise why it was inferred. */
  source: "task" | "reply" | "sla" | "uncontacted";
};

export type TaskScope = "overdue" | "today" | "upcoming" | "done" | "open";

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createTask(input: {
  organizationId: string;
  leadId?: string | null;
  pipelineItemId?: string | null;
  title: string;
  instruction?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
  dueAt?: Date | null;
  ownerId?: string | null;
  createdBy?: string | null;
  createdKind?: "user" | "ai" | "system";
}) {
  const task = await prisma.task.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId ?? null,
      pipelineItemId: input.pipelineItemId ?? null,
      title: input.title,
      instruction: input.instruction ?? null,
      kind: input.kind ?? "follow_up",
      priority: input.priority ?? "none",
      dueAt: input.dueAt ?? null,
      ownerId: input.ownerId ?? null,
      createdBy: input.createdBy ?? null,
      createdKind: input.createdKind ?? "user",
    },
  });

  // Tell the owner now, not when it comes due. Best-effort: a notification that
  // fails must not lose the task it was about.
  if (task.ownerId) {
    await notifyTaskAssigned(task, input.createdBy ?? null).catch((e) =>
      console.error("[tasks] assignment notification failed:", e),
    );
  }
  return task;
}

/**
 * "You have a new task" — the bell always, email unless they turned it off.
 *
 * Skips self-assignment via `notify`'s actor check: being told about something
 * you just did yourself is noise, and noise is how people learn to ignore the
 * bell entirely.
 */
async function notifyTaskAssigned(
  task: { id: string; organizationId: string; ownerId: string | null; title: string; dueAt: Date | null; leadId: string | null },
  actorId: string | null,
) {
  if (!task.ownerId) return;
  const { notify } = await import("./notifications");
  const due = task.dueAt ? ` Due ${task.dueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.` : "";
  const href = task.leadId ? `/dashboard/leads/${task.leadId}` : "/dashboard/tasks";

  await notify({
    organizationId: task.organizationId,
    userId: task.ownerId,
    actorId,
    kind: "task_assigned",
    title: task.title,
    body: `A task was assigned to you.${due}`,
    href,
    entityType: "task",
    entityId: task.id,
    prefKey: "taskAssigned",
    email: {
      subject: `New task: ${task.title}`,
      body: `A task has been assigned to you.

${task.title}${due}

Open it: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}${href}`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

/** The subset of TenantContext the assignment rules actually read. */
export type AssignerContext = {
  orgId: string;
  userId: string;
  role: string;
  department: string | null;
};

const MEMBER_SELECT = {
  userId: true,
  role: true,
  department: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MemberSelect;

export type AssignableMember = Prisma.MemberGetPayload<{ select: typeof MEMBER_SELECT }>;

/**
 * Who this caller may hand a task to.
 *
 * Reuses the scoping leads and pipelines already follow rather than inventing a
 * second permission model: owner and admin reach the whole workspace, a group
 * leader reaches their own department, and everyone else can only give work to
 * themselves. A group leader with no department set is treated as the latter,
 * because "same department as me" is not a filter you can build from null.
 *
 * Returns the list rather than a per-id boolean, because that is what lets the
 * dialog render a picker at all -- and hide it entirely when there is exactly
 * one legal answer.
 */
export async function assignableMembers(ctx: AssignerContext): Promise<AssignableMember[]> {
  const selfOnly =
    (ctx.role !== "owner" && ctx.role !== "admin" && ctx.role !== "group_leader") ||
    (ctx.role === "group_leader" && !ctx.department);

  if (selfOnly) {
    const me = await prisma.member.findFirst({
      where: { organizationId: ctx.orgId, userId: ctx.userId },
      select: MEMBER_SELECT,
    });
    return me ? [me] : [];
  }

  return prisma.member.findMany({
    where: {
      organizationId: ctx.orgId,
      // Owners and admins pass no department filter. A group leader sees their
      // own department, plus themselves in case they sit outside it.
      ...(ctx.role === "group_leader"
        ? { OR: [{ department: ctx.department as Department }, { userId: ctx.userId }] }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: MEMBER_SELECT,
  });
}

/**
 * True when `ownerId` is someone this caller may assign to.
 *
 * Worth being strict here: `Task.ownerId` is a raw userId with no foreign key,
 * so before this check the API would accept and store any string at all.
 */
export async function canAssignTo(ctx: AssignerContext, ownerId: string): Promise<boolean> {
  if (ownerId === ctx.userId) return true;
  const allowed = await assignableMembers(ctx);
  return allowed.some((m) => m.userId === ownerId);
}

/** Scoped by org in the WHERE, so a foreign id can never be completed. */
export async function completeTask(organizationId: string, taskId: string) {
  const res = await prisma.task.updateMany({
    where: { id: taskId, organizationId },
    data: { status: "done", completedAt: new Date() },
  });
  return res.count > 0;
}

export async function reopenTask(organizationId: string, taskId: string) {
  const res = await prisma.task.updateMany({
    where: { id: taskId, organizationId },
    data: { status: "open", completedAt: null },
  });
  return res.count > 0;
}

export async function updateTask(
  organizationId: string,
  taskId: string,
  data: {
    title?: string;
    instruction?: string | null;
    kind?: TaskKind;
    priority?: TaskPriority;
    dueAt?: Date | null;
    ownerId?: string | null;
    status?: TaskStatus;
  },
  /** Who is making the change, so they are not notified about their own action. */
  actorId?: string | null,
) {
  // Read the previous owner first: reassignment should tell the new person, and
  // re-saving a task without touching ownership should tell nobody at all.
  const before = data.ownerId !== undefined
    ? await prisma.task.findFirst({ where: { id: taskId, organizationId }, select: { ownerId: true } })
    : null;

  const res = await prisma.task.updateMany({ where: { id: taskId, organizationId }, data });
  if (res.count === 0) return false;

  if (data.ownerId && before && before.ownerId !== data.ownerId) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, organizationId: true, ownerId: true, title: true, dueAt: true, leadId: true },
    });
    if (task) await notifyTaskAssigned(task, actorId ?? null).catch((e) => console.error("[tasks] reassignment notification failed:", e));
  }
  return true;
}

export async function deleteTask(organizationId: string, taskId: string) {
  const res = await prisma.task.deleteMany({ where: { id: taskId, organizationId } });
  return res.count > 0;
}

/**
 * Create a follow-up for an inbound reply — unless one is already open.
 *
 * Called from the conversation recorder, which every channel writes through, so
 * a WhatsApp reply and an email reply both produce a task without either adapter
 * knowing tasks exist. Idempotent by design: a chatty contact sending five
 * messages should produce one thing to do, not five.
 */
export async function ensureReplyFollowUp(args: {
  organizationId: string;
  leadId: string;
  channel: string;
}): Promise<void> {
  const open = await prisma.task.findFirst({
    where: { organizationId: args.organizationId, leadId: args.leadId, status: "open" },
    select: { id: true },
  });
  if (open) return;

  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, organizationId: args.organizationId },
    select: { firstName: true, lastName: true, email: true },
  });
  const who = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ") || lead?.email || "this contact";

  // Ownership follows the pipeline item — whoever owns the deal owns the reply.
  const item = await prisma.pipelineItem.findFirst({
    where: { organizationId: args.organizationId, leadId: args.leadId, closedAt: null },
    select: { id: true, ownerId: true },
  });

  await createTask({
    organizationId: args.organizationId,
    leadId: args.leadId,
    pipelineItemId: item?.id ?? null,
    title: `Reply to ${who}`,
    kind: channelToKind(args.channel),
    // Due now: a reply that has been sitting unanswered is already the work.
    dueAt: new Date(),
    ownerId: item?.ownerId ?? null,
    createdKind: "system",
  });
}

function channelToKind(channel: string): TaskKind {
  switch (channel) {
    case "email": return "email";
    case "whatsapp": return "whatsapp";
    case "linkedin": return "linkedin";
    default: return "follow_up";
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function scopeWhere(scope: TaskScope): Prisma.TaskWhereInput {
  switch (scope) {
    case "overdue":
      return { status: "open", dueAt: { lt: startOfToday() } };
    case "today":
      // An undated open task is work you accepted with no deadline — it belongs
      // in Today rather than nowhere, or it is never seen again.
      return { status: "open", OR: [{ dueAt: { gte: startOfToday(), lte: endOfToday() } }, { dueAt: null }] };
    case "upcoming":
      return { status: "open", dueAt: { gt: endOfToday() } };
    case "done":
      return { status: "done" };
    case "open":
      return { status: "open" };
  }
}

const TASK_SELECT = {
  id: true,
  leadId: true,
  title: true,
  instruction: true,
  kind: true,
  priority: true,
  status: true,
  dueAt: true,
  ownerId: true,
  createdKind: true,
  completedAt: true,
  createdAt: true,
  lead: { select: { id: true, firstName: true, lastName: true, email: true, company: true } },
} satisfies Prisma.TaskSelect;

export type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

/**
 * Attach a display name to each task's owner.
 *
 * `Task.ownerId` is a raw userId with no relation, so a list of tasks on its own
 * cannot say whose they are — which is the whole point of the Everyone view.
 * Resolved in one batched query rather than per row.
 */
export async function withOwnerNames<T extends { ownerId: string | null }>(
  rows: T[],
): Promise<(T & { ownerName: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, ownerName: null }));

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => ({ ...r, ownerName: r.ownerId ? byId.get(r.ownerId) ?? null : null }));
}

export async function listTasks(
  organizationId: string,
  opts: { scope?: TaskScope; ownerId?: string; ownerIds?: string[] | null; leadId?: string; limit?: number } = {},
): Promise<TaskRow[]> {
  const { scope = "open", ownerId, ownerIds, leadId, limit = 200 } = opts;
  return prisma.task.findMany({
    where: {
      organizationId,
      ...scopeWhere(scope),
      // `ownerId` is the caller narrowing to one person ("my tasks", or an
      // owner drilling into a member). `ownerIds` is the role scope: who this
      // caller is allowed to see at all, from lib/scope.ts taskOwnerScope.
      // Null means unrestricted; an empty array means nobody, which must stay
      // an empty result rather than silently matching everything.
      ...(ownerId ? { ownerId } : ownerIds ? { ownerId: { in: ownerIds } } : {}),
      ...(leadId ? { leadId } : {}),
    },
    // Nulls last so dated work leads; done tasks read newest-first instead.
    // Priority outranks the clock: a high-priority task due Friday should sit
    // above a none-priority one due Thursday, or setting it changed nothing.
    orderBy:
      scope === "done"
        ? { completedAt: "desc" }
        : [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: limit,
    select: TASK_SELECT,
  });
}

/** The four buckets the Tasks screen renders, in one round of queries. */
export async function getTaskBuckets(organizationId: string, ownerId?: string, ownerIds?: string[] | null) {
  const [overdue, today, upcoming, done] = await Promise.all([
    listTasks(organizationId, { scope: "overdue", ownerId, ownerIds }),
    listTasks(organizationId, { scope: "today", ownerId, ownerIds }),
    listTasks(organizationId, { scope: "upcoming", ownerId, ownerIds }),
    listTasks(organizationId, { scope: "done", ownerId, ownerIds, limit: 25 }),
  ]);
  return { overdue, today, upcoming, done };
}

export function taskLabel(t: { title: string; dueAt: Date | null }): string {
  if (!t.dueAt) return t.title;
  const due = new Date(t.dueAt);
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const time = due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (due < today) return `${t.title} · overdue`;
  if (due <= endOfToday()) return `${t.title} · today ${time}`;
  if (due < new Date(tomorrow.getTime() + 86_400_000)) return `${t.title} · tomorrow ${time}`;
  return `${t.title} · ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/**
 * Next action for many contacts at once.
 *
 * Batched deliberately: the leads table renders this column for 50 rows, and a
 * per-row query would be 50 round trips for one screen. Four bounded queries
 * serve any page size instead.
 */
export async function nextActionsFor(
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, NextAction>> {
  const out = new Map<string, NextAction>();
  if (leadIds.length === 0) return out;

  const [tasks, events, items, leads] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId, leadId: { in: leadIds }, status: "open" },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, leadId: true, title: true, kind: true, dueAt: true },
    }),
    // No `distinct on` in the Prisma client — pull recent events and reduce to
    // one per lead in JS. Capped, since this only needs the latest per contact.
    prisma.conversationEvent.findMany({
      where: { organizationId, leadId: { in: leadIds } },
      orderBy: { occurredAt: "desc" },
      take: Math.min(leadIds.length * 4, 2000),
      select: { leadId: true, direction: true, channel: true, occurredAt: true },
    }),
    prisma.pipelineItem.findMany({
      where: { organizationId, leadId: { in: leadIds }, closedAt: null },
      select: { leadId: true, slaBreachedAt: true, stage: { select: { name: true } } },
    }),
    prisma.lead.findMany({
      where: { organizationId, id: { in: leadIds } },
      select: { id: true, stage: true, optedOut: true },
    }),
  ]);

  const firstTaskByLead = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) if (t.leadId && !firstTaskByLead.has(t.leadId)) firstTaskByLead.set(t.leadId, t);

  const latestByLead = new Map<string, (typeof events)[number]>();
  const hasOutbound = new Set<string>();
  for (const e of events) {
    if (!latestByLead.has(e.leadId)) latestByLead.set(e.leadId, e);
    if (e.direction === "outbound") hasOutbound.add(e.leadId);
  }

  const itemByLead = new Map(items.map((i) => [i.leadId, i]));
  const now = Date.now();

  for (const lead of leads) {
    // An opted-out contact has exactly one correct next action: none.
    if (lead.optedOut) continue;

    // 1. A real task always wins — someone decided this on purpose.
    const task = firstTaskByLead.get(lead.id);
    if (task) {
      out.set(lead.id, {
        taskId: task.id,
        label: taskLabel(task),
        kind: task.kind,
        dueAt: task.dueAt,
        urgent: !!task.dueAt && task.dueAt.getTime() <= now,
        source: "task",
      });
      continue;
    }

    // 2. They spoke last and nobody answered.
    const latest = latestByLead.get(lead.id);
    if (latest?.direction === "inbound") {
      out.set(lead.id, {
        taskId: null,
        label: "Reply now",
        kind: channelToKind(latest.channel),
        dueAt: null,
        urgent: true,
        source: "reply",
      });
      continue;
    }

    // 3. Sitting past its stage SLA.
    const item = itemByLead.get(lead.id);
    if (item?.slaBreachedAt) {
      out.set(lead.id, {
        taskId: null,
        label: `Overdue in ${item.stage.name}`,
        kind: "follow_up",
        dueAt: null,
        urgent: true,
        source: "sla",
      });
      continue;
    }

    // 4. Never contacted at all.
    if (lead.stage === "new" && !hasOutbound.has(lead.id)) {
      out.set(lead.id, {
        taskId: null,
        label: "Contact",
        kind: "follow_up",
        dueAt: null,
        urgent: false,
        source: "uncontacted",
      });
    }
    // Otherwise: nothing owed. The UI shows "Waiting" for an absent entry.
  }

  return out;
}

/** Single-contact convenience for the lead detail page. */
export async function nextActionFor(organizationId: string, leadId: string): Promise<NextAction | null> {
  const map = await nextActionsFor(organizationId, [leadId]);
  return map.get(leadId) ?? null;
}
