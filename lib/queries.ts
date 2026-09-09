/**
 * Server-side data functions for the dashboard's Server Components. These run on the
 * server (co-located with the DB), so pages render with data already in the HTML —
 * fast first paint, no client waterfall, nothing cached on disk. The results are
 * handed to the client as SWR fallback (keyed by the same URL the client fetches).
 *
 * Query shapes here MUST match the matching /api routes so the client's background
 * revalidation returns the identical shape.
 */
import { prisma } from "./db";
import { cached } from "./cache";
import { configured } from "./env";
import { SEED_TEMPLATES } from "./templates-seed";
import { nextActionsFor, nextActionFor, getTaskBuckets, startOfToday, type NextAction } from "./tasks";
import { getBoard } from "./pipeline";
import type { Prisma } from "@prisma/client";

/**
 * The only safe projection of a SendingAccount. The row also carries `pass`,
 * `refreshToken` and `dkimPrivateKey` — none of which may reach a client, so a
 * bare `include: { sendingAccount: true }` anywhere is a credential leak, not a
 * convenience. Exported so every caller shares one list instead of re-deriving it.
 */
export const SEND_ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  provider: true,
  host: true,
  port: true,
  secure: true,
  user: true,
  from: true,
  active: true,
  createdAt: true,
} satisfies Prisma.SendingAccountSelect;

/**
 * Shared shape for every campaign list/detail read. Keeps all Campaign scalars
 * (so the client shape is unchanged) while narrowing the sending account to the
 * safe field list above — the reason this is a constant rather than three
 * hand-written `include`s is that the three drifted apart once already.
 */
export const CAMPAIGN_INCLUDE = {
  sendingAccount: { select: SEND_ACCOUNT_SELECT },
  _count: { select: { enrollments: true } },
} satisfies Prisma.CampaignInclude;

/**
 * Sending domains for the Accounts screen. Shape MUST match GET /api/domains,
 * because it is handed straight to SWR as that key's fallback.
 */
export async function getSendingDomains(orgId: string) {
  const domains = await prisma.domain.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      dnsMode: true,
      expiresAt: true,
      autoRenew: true,
      verifiedAt: true,
      failureReason: true,
      createdAt: true,
      records: {
        select: {
          id: true,
          kind: true,
          type: true,
          host: true,
          expectedValue: true,
          observedValue: true,
          status: true,
          lastCheckedAt: true,
        },
        orderBy: { kind: "asc" },
      },
      _count: { select: { mailboxes: true } },
    },
  });

  return {
    available: configured.storefront,
    domains: domains.map((d) => ({
      ...d,
      mailboxCount: d._count.mailboxes,
      _count: undefined,
      recordsVerified: d.records.filter((r) => r.status === "verified").length,
      recordsTotal: d.records.length,
    })),
  };
}

export function getSendingAccounts(orgId: string) {
  return prisma.sendingAccount.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: SEND_ACCOUNT_SELECT,
  });
}

export async function getTemplates(orgId: string) {
  let templates = await prisma.template.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  if (templates.length === 0) {
    await prisma.template.createMany({ data: SEED_TEMPLATES.map((t) => ({ ...t, organizationId: orgId })) });
    templates = await prisma.template.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  }
  return templates;
}

export function getCampaigns(orgId: string) {
  return prisma.campaign.findMany({
    where: { organizationId: orgId },
    include: CAMPAIGN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export function getSegments(orgId: string) {
  return prisma.segment.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
}

/** Companies derived from contacts (grouped by the `company` field). */
export async function getCompanies(orgId: string) {
  const rows = await prisma.lead.groupBy({
    by: ["company"],
    where: { organizationId: orgId, company: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { company: "desc" } },
    take: 200,
  });
  return rows
    .filter((r) => (r.company ?? "").trim() !== "")
    .map((r) => ({ company: r.company as string, count: r._count._all }));
}

export async function getInboxThreads(orgId: string, status?: string, leadWhere?: Prisma.LeadWhereInput) {
  const threads = await prisma.inboxThread.findMany({
    where: {
      organizationId: orgId,
      ...(status ? { status: status as never } : {}),
      // A reply thread belongs to whoever owns the contact. Without this a rep
      // could read a colleague's conversation by opening the inbox.
      ...(leadWhere ? { lead: leadWhere } : {}),
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, email: true, company: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });
  return threads.map((t) => ({
    id: t.id,
    status: t.status,
    subject: t.subject,
    channel: t.channel,
    lastMessageAt: t.lastMessageAt,
    lead: t.lead,
    preview: t.messages[0]?.body?.slice(0, 140) ?? "",
    direction: t.messages[0]?.direction ?? null,
  }));
}

/**
 * `scopeWhere` is the caller's lead scope (lib/scope.ts). It is combined with
 * AND rather than spread, because the scope carries its own OR (assigned /
 * created by me) and the search below carries another — merged into one object
 * the second would replace the first and widen the result.
 *
 * Omitting it renders the whole workspace, which for a server-side fallback
 * means a member sees everyone's contacts for one paint before SWR corrects it.
 */
export async function getLeadsPage(
  orgId: string,
  page = 1,
  pageSize = 50,
  q?: string,
  book?: "email" | "linkedin",
  scopeWhere?: Prisma.LeadWhereInput,
) {
  const where: Prisma.LeadWhereInput = {
    ...(scopeWhere ? { AND: [scopeWhere] } : { organizationId: orgId }),
    ...(book === "email" ? { email: { not: null } } : book === "linkedin" ? { linkedinUrl: { not: null } } : {}),
    ...(q?.trim()
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  // The scope is part of the cache key, or a member is served the owner's
  // cached total and sees a count that does not match their own list.
  const scopeKey = scopeWhere ? JSON.stringify(scopeWhere) : "all";
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: pageSize, skip: (page - 1) * pageSize }),
    cached(`leads:count:${orgId}:${scopeKey}:${book ?? ""}:${q ?? ""}`, 15_000, () => prisma.lead.count({ where })),
  ]);
  // Same enrichment the API route applies — the SWR fallback must be the identical shape.
  const items = await enrichLeadRows(orgId, rows);
  return { items, total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) };
}

/* ------------------------------------------------------------------ */
/* Lead list enrichment                                                */
/* ------------------------------------------------------------------ */

type LeadRowBase = { id: string; leadSourceId: string | null };

/**
 * Attach the columns the V3 leads table shows but the Lead row doesn't carry:
 * source label, owner, last activity and — the important one — next action.
 *
 * Shared by the API route and the server-render path so the two can't drift, and
 * batched throughout: one page of 50 contacts costs a fixed handful of queries,
 * not 50 × 4.
 */
export async function enrichLeadRows<T extends LeadRowBase>(orgId: string, leads: T[]) {
  if (leads.length === 0) return [] as (T & { source: string | null; ownerName: string | null; lastActivityAt: Date | null; nextAction: NextAction | null })[];

  const ids = leads.map((l) => l.id);
  const sourceIds = [...new Set(leads.map((l) => l.leadSourceId).filter((s): s is string => !!s))];

  const [actions, sources, items, latest] = await Promise.all([
    nextActionsFor(orgId, ids),
    sourceIds.length
      ? prisma.leadSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, label: true } })
      : Promise.resolve([]),
    prisma.pipelineItem.findMany({
      where: { organizationId: orgId, leadId: { in: ids }, closedAt: null },
      select: { leadId: true, ownerId: true },
    }),
    prisma.conversationEvent.findMany({
      where: { organizationId: orgId, leadId: { in: ids } },
      orderBy: { occurredAt: "desc" },
      take: Math.min(ids.length * 3, 1500),
      select: { leadId: true, occurredAt: true },
    }),
  ]);

  const sourceLabel = new Map(sources.map((s) => [s.id, s.label]));
  const ownerByLead = new Map(items.map((i) => [i.leadId, i.ownerId]));
  const lastByLead = new Map<string, Date>();
  for (const e of latest) if (!lastByLead.has(e.leadId)) lastByLead.set(e.leadId, e.occurredAt);

  const ownerIds = [...new Set([...ownerByLead.values()].filter((s): s is string => !!s))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
    : [];
  const ownerName = new Map(owners.map((o) => [o.id, o.name || o.email]));

  return leads.map((l) => {
    const oid = ownerByLead.get(l.id) ?? null;
    return {
      ...l,
      source: l.leadSourceId ? (sourceLabel.get(l.leadSourceId) ?? null) : null,
      ownerName: oid ? (ownerName.get(oid) ?? null) : null,
      lastActivityAt: lastByLead.get(l.id) ?? null,
      nextAction: actions.get(l.id) ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Lead detail — the unified contact record                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the lead page needs, in one round of queries.
 *
 * The timeline is deliberately NOT included here — it paginates independently, so
 * opening a contact with two years of history doesn't drag the whole record with it.
 */
/**
 * `scopeWhere` gates access, not just listing. Org scope alone means a rep can
 * open a colleague's contact — and its whole timeline — by pasting the id into
 * the URL, which makes the scoped list a UI convention rather than a rule.
 * Returns null when out of scope, which callers surface as a 404 (not a 403:
 * confirming a contact exists but is somebody else's is itself a leak).
 */
export async function getLeadDetail(orgId: string, leadId: string, scopeWhere?: Prisma.LeadWhereInput) {
  const lead = await prisma.lead.findFirst({
    where: scopeWhere ? { AND: [scopeWhere], id: leadId } : { id: leadId, organizationId: orgId },
    include: {
      contactIdentities: { select: { id: true, kind: true, value: true, source: true, verifiedAt: true } },
      leadSource: { select: { id: true, key: true, label: true } },
      tasks: {
        where: { status: "open" },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: { id: true, title: true, kind: true, dueAt: true, ownerId: true, createdKind: true },
      },
      pipelineItems: {
        where: { closedAt: null },
        select: {
          id: true,
          value: true,
          ownerId: true,
          enteredStageAt: true,
          slaDueAt: true,
          slaBreachedAt: true,
          stage: { select: { id: true, name: true, kind: true } },
          pipeline: {
            select: {
              id: true,
              name: true,
              department: true,
              stages: { orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } },
            },
          },
        },
      },
      enrollments: {
        where: { status: { in: ["active", "paused"] } },
        select: { id: true, status: true, nextRunAt: true, campaign: { select: { id: true, name: true } } },
      },
    },
  });
  if (!lead) return null;

  // Owner names for the CRM rail. Raw userIds are stored (memberships change), so
  // resolve them here rather than storing a denormalised copy that goes stale.
  const ownerIds = [
    ...new Set([
      ...lead.pipelineItems.map((i) => i.ownerId),
      ...lead.tasks.map((t) => t.ownerId),
    ].filter((id): id is string => !!id)),
  ];
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
    : [];

  const nextAction = await nextActionFor(orgId, leadId);

  return {
    ...lead,
    // Decimal doesn't survive JSON — normalise to a number at the boundary so the
    // RSC fallback and the API response are the identical shape.
    pipelineItems: lead.pipelineItems.map((i) => ({ ...i, value: i.value ? Number(i.value) : null })),
    owners,
    nextAction,
  };
}

export type TimelineEntry = {
  id: string;
  at: Date;
  /** message | activity | stage | note | task */
  kind: string;
  channel: string | null;
  direction: string | null;
  title: string;
  body: string | null;
  actor: string | null;
};

/**
 * One timeline per contact, merged from every table that records something
 * happening to them. The UI must never need to know which table an entry came
 * from — that is the whole point of the unified record.
 */
export async function getLeadTimeline(
  orgId: string,
  leadId: string,
  limit = 100,
  scopeWhere?: Prisma.LeadWhereInput,
): Promise<TimelineEntry[]> {
  // Same gate as getLeadDetail: the timeline is the conversation, so reading it
  // for somebody else's contact is the leak the list scope exists to prevent.
  if (scopeWhere) {
    const allowed = await prisma.lead.findFirst({ where: { AND: [scopeWhere], id: leadId }, select: { id: true } });
    if (!allowed) return [];
  }
  const items = await prisma.pipelineItem.findMany({
    where: { organizationId: orgId, leadId },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);

  const [events, activities, transitions, notes, tasks] = await Promise.all([
    prisma.conversationEvent.findMany({
      where: { organizationId: orgId, leadId },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, channel: true, direction: true, subject: true, body: true, status: true, occurredAt: true },
    }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId, leadId },
      orderBy: { at: "desc" },
      take: limit,
      select: { id: true, type: true, channel: true, at: true },
    }),
    itemIds.length
      ? prisma.stageTransition.findMany({
          where: { itemId: { in: itemIds } },
          orderBy: { at: "desc" },
          take: limit,
          select: { id: true, fromStageId: true, toStageId: true, direction: true, reason: true, actorKind: true, actorId: true, at: true },
        })
      : Promise.resolve([]),
    prisma.note.findMany({
      where: { organizationId: orgId, leadId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, body: true, authorId: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId, leadId, status: "done" },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: { id: true, title: true, kind: true, completedAt: true },
    }),
  ]);

  // Stage ids → names, and actor/author ids → names, resolved in two batches
  // rather than per row.
  const stageIds = [...new Set(transitions.flatMap((t) => [t.fromStageId, t.toStageId]).filter((s): s is string => !!s))];
  const personIds = [...new Set([...notes.map((n) => n.authorId), ...transitions.map((t) => t.actorId)].filter((s): s is string => !!s))];
  const [stages, people] = await Promise.all([
    stageIds.length ? prisma.pipelineStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, name: true } }) : [],
    personIds.length ? prisma.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const personName = new Map(people.map((p) => [p.id, p.name || p.email]));

  const entries: TimelineEntry[] = [
    ...events.map((e) => ({
      id: `ce-${e.id}`,
      at: e.occurredAt,
      kind: "message",
      channel: e.channel,
      direction: e.direction,
      title: e.direction === "inbound" ? `${e.channel} received` : `${e.channel} sent`,
      body: e.subject ? `${e.subject}\n${e.body ?? ""}`.trim() : (e.body ?? null),
      actor: null,
    })),
    ...activities.map((a) => ({
      id: `al-${a.id}`,
      at: a.at,
      kind: "activity",
      channel: a.channel,
      direction: null,
      title: a.type,
      body: null,
      actor: null,
    })),
    ...transitions.map((t) => ({
      id: `st-${t.id}`,
      at: t.at,
      kind: "stage",
      channel: null,
      direction: t.direction,
      title: t.fromStageId
        ? `Moved ${stageName.get(t.fromStageId) ?? "?"} → ${stageName.get(t.toStageId) ?? "?"}`
        : `Entered ${stageName.get(t.toStageId) ?? "?"}`,
      body: t.reason,
      actor: t.actorKind === "ai" ? "AI" : t.actorKind === "system" ? "System" : (t.actorId ? personName.get(t.actorId) ?? null : null),
    })),
    ...notes.map((n) => ({
      id: `nt-${n.id}`,
      at: n.createdAt,
      kind: "note",
      channel: null,
      direction: null,
      title: "Note",
      body: n.body,
      actor: n.authorId ? personName.get(n.authorId) ?? null : null,
    })),
    ...tasks.map((t) => ({
      id: `tk-${t.id}`,
      at: t.completedAt ?? new Date(0),
      kind: "task",
      channel: null,
      direction: null,
      title: `Completed: ${t.title}`,
      body: null,
      actor: null,
    })),
  ];

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Tasks + Home                                                        */
/* ------------------------------------------------------------------ */

/**
 * `ownerIds` is the role scope (lib/scope.ts taskOwnerScope) — who this caller
 * may see at all. Passing it is not optional for a request-backed read: the SSR
 * fallback must match what /api/tasks returns, or the screen renders the whole
 * workspace for a second and then snaps back.
 */
export function getTasks(orgId: string, ownerId?: string, ownerIds?: string[] | null) {
  return getTaskBuckets(orgId, ownerId, ownerIds);
}

/**
 * Contacts whose last word was theirs — nobody has answered yet.
 *
 * Deliberately NOT `getControlTower`, which walks open pipeline items: a lead who
 * replied but was never added to a pipeline would be invisible, and that is
 * precisely the lead most likely to fall through. Attention follows the
 * conversation, not the funnel.
 */
async function getUnanswered(orgId: string, limit = 8) {
  // Bounded scan of recent history, reduced to one event per contact. This is a
  // snapshot of what's live, not an audit of everything ever said.
  const events = await prisma.conversationEvent.findMany({
    where: { organizationId: orgId },
    orderBy: { occurredAt: "desc" },
    take: 600,
    select: { leadId: true, channel: true, direction: true, subject: true, body: true, occurredAt: true },
  });

  const latestByLead = new Map<string, (typeof events)[number]>();
  for (const e of events) if (!latestByLead.has(e.leadId)) latestByLead.set(e.leadId, e);

  const waiting = [...latestByLead.values()]
    .filter((e) => e.direction === "inbound")
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
  if (waiting.length === 0) return [];

  const leadIds = waiting.map((e) => e.leadId);
  const [leads, items] = await Promise.all([
    prisma.lead.findMany({
      where: { organizationId: orgId, id: { in: leadIds } },
      select: { id: true, firstName: true, lastName: true, email: true, company: true, stage: true },
    }),
    prisma.pipelineItem.findMany({
      where: { organizationId: orgId, leadId: { in: leadIds }, closedAt: null },
      select: { id: true, leadId: true, ownerId: true, stage: { select: { name: true } } },
    }),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const itemByLead = new Map(items.map((i) => [i.leadId, i]));

  const ownerIds = [...new Set(items.map((i) => i.ownerId).filter((s): s is string => !!s))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  return waiting.flatMap((e) => {
    const lead = leadById.get(e.leadId);
    if (!lead) return [];
    const item = itemByLead.get(e.leadId) ?? null;
    return [{
      // The lead id is the stable key here — not every waiting contact has a pipeline item.
      pipelineItemId: item?.id ?? e.leadId,
      lead: { id: lead.id, firstName: lead.firstName, lastName: lead.lastName, email: lead.email, company: lead.company },
      stage: item?.stage.name ?? lead.stage,
      owner: item?.ownerId ? (ownerById.get(item.ownerId) ?? null) : null,
      lastEvent: {
        channel: e.channel,
        direction: e.direction,
        preview: (e.subject || e.body || "").slice(0, 140),
        occurredAt: e.occurredAt,
      },
      awaitingReply: true,
    }];
  });
}

/**
 * The Home payload — deliberately "what needs you", not "how are we doing".
 *
 * Analytics live on Reports. A rep opening the app at 9am needs a work queue.
 */
/**
 * `scope` narrows Home to what one person can see, or — with viewAs — to one
 * named person. Both come from lib/scope.ts, so a member's own dashboard and an
 * owner drilling into that member render through the same path rather than two.
 * Omitted, it behaves exactly as before: the whole workspace.
 */
export async function getHome(
  orgId: string,
  scope?: { where: Prisma.LeadWhereInput; userIds: string[] | null },
  /** Non-null for roles that may see unassigned contacts — see lib/scope.ts. */
  unassignedWhere?: Prisma.LeadWhereInput | null,
) {
  const today = startOfToday();
  const leadWhere: Prisma.LeadWhereInput = scope ? { AND: [scope.where] } : { organizationId: orgId };
  // A single user in scope means "just this person's work", which is what the
  // task buckets key on. Null means unrestricted.
  const ownerId = scope?.userIds?.length === 1 ? scope.userIds[0] : undefined;
  // More than one user in scope (a manager's department) still has to be
  // bounded — otherwise Home's task counts would span the whole workspace while
  // the contact counts beside them do not.
  const ownerIds = scope ? scope.userIds : null;

  const [attention, buckets, board, newLeads, newLeadsBySource, unreadReplies, overdueItems, unassigned] = await Promise.all([
    getUnanswered(orgId, 8),
    getTaskBuckets(orgId, ownerId, ownerIds),
    getBoard(orgId).catch(() => null),
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: today } } }),
    // No `leadSourceId: { not: null }` filter: a lead added by hand has no source
    // row, and excluding it would make this panel contradict the counter above it.
    prisma.lead.groupBy({
      by: ["leadSourceId"],
      where: { ...leadWhere, createdAt: { gte: today } },
      _count: { _all: true },
    }),
    prisma.inboxThread.count({
      where: {
        organizationId: orgId,
        status: "unread",
        // A thread is only yours if its contact is.
        ...(scope ? { lead: scope.where } : {}),
      },
    }),
    prisma.pipelineItem.count({
      where: {
        organizationId: orgId,
        closedAt: null,
        slaBreachedAt: { not: null },
        ...(ownerId ? { ownerId } : {}),
      },
    }),
    // Contacts no assignment rule landed on. Zero for a rep — they cannot see
    // them — and a number for whoever is accountable for the work getting
    // picked up. This is what stops a broken rule from being invisible.
    unassignedWhere ? prisma.lead.count({ where: unassignedWhere }) : Promise.resolve(0),
  ]);

  const sourceIds = newLeadsBySource.map((r) => r.leadSourceId).filter((s): s is string => !!s);
  const sources = sourceIds.length
    ? await prisma.leadSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, label: true } })
    : [];
  const sourceLabel = new Map(sources.map((s) => [s.id, s.label]));

  const followUpsDue = [...buckets.overdue, ...buckets.today];
  const pipelineValue = board
    ? board.stages
        .filter((s) => s.kind === "open")
        .reduce((sum, s) => sum + s.items.reduce((n, i) => n + (i.value ?? 0), 0), 0)
    : 0;

  return {
    counts: {
      newLeads,
      followUpsDue: followUpsDue.length,
      unreadReplies,
      overdueItems,
      unassigned,
    },
    attention,
    followUps: followUpsDue.slice(0, 8),
    leadsBySource: newLeadsBySource
      .map((r) => ({
        label: r.leadSourceId ? (sourceLabel.get(r.leadSourceId) ?? "Other") : "Added by hand",
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    pipeline: board
      ? {
          name: board.pipeline.name,
          value: pipelineValue,
          stages: board.stages.map((s) => ({ name: s.name, kind: s.kind, count: s.items.length })),
        }
      : null,
  };
}

export type Home = Awaited<ReturnType<typeof getHome>>;

/* ------------------------------------------------------------------ */
/* Onboarding + activation                                             */
/* ------------------------------------------------------------------ */

/** Bump to re-offer the tour to everyone after materially changing its steps. */
export const TOUR_VERSION = 1;

export type OnboardingState = {
  completedAt: string | null;
  skippedAt: string | null;
  step: number;
  tourVersion: number;
  theme: string | null;
  checklistDismissedAt: string | null;
};

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    // Select only the app-owned columns — never widen this to the whole user row.
    select: {
      onboardingCompletedAt: true,
      onboardingSkippedAt: true,
      onboardingStep: true,
      tourVersion: true,
      themePreference: true,
      checklistState: true,
    },
  });
  const checklist = (u?.checklistState ?? null) as { dismissedAt?: string | null } | null;
  return {
    completedAt: u?.onboardingCompletedAt?.toISOString() ?? null,
    skippedAt: u?.onboardingSkippedAt?.toISOString() ?? null,
    step: u?.onboardingStep ?? 0,
    tourVersion: u?.tourVersion ?? 0,
    theme: u?.themePreference ?? null,
    checklistDismissedAt: checklist?.dismissedAt ?? null,
  };
}

export type Activation = {
  sendingAccount: boolean;
  leads: boolean;
  template: boolean;
  campaign: boolean;
  sent: boolean;
};

/**
 * Activation is DERIVED from real data on every read, never stored. A stored
 * "done" flag drifts the moment a user deletes the thing it was counting, and
 * then the checklist quietly lies about the state of the workspace.
 */
export async function getActivation(orgId: string): Promise<Activation> {
  return cached(`activation:${orgId}`, 30_000, async () => {
    const [sendingAccount, leads, template, campaign, sent] = await Promise.all([
      prisma.sendingAccount.count({ where: { organizationId: orgId }, take: 1 }),
      prisma.lead.count({ where: { organizationId: orgId }, take: 1 }),
      prisma.template.count({ where: { organizationId: orgId }, take: 1 }),
      prisma.campaign.count({ where: { organizationId: orgId }, take: 1 }),
      prisma.message.count({ where: { organizationId: orgId, status: "sent" }, take: 1 }),
    ]);
    return {
      sendingAccount: sendingAccount > 0,
      leads: leads > 0,
      template: template > 0,
      campaign: campaign > 0,
      sent: sent > 0,
    };
  });
}
