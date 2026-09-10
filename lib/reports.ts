/**
 * Reports aggregations — funnel, engagement rates, time series, and per-campaign
 * breakdown, all from Message + ActivityLog (the event store). Fed to /dashboard/reports.
 *
 * getPipelineFunnels/getSourceRoi/getResponseLeaderboard are additive: the funnel above
 * (`getReport`) still groups by the legacy Lead.stage enum, which older campaign-only
 * flows still write. These three read the newer Pipeline/PipelineItem/StageTransition
 * model instead, since that's what the product PRD's §8 reporting actually calls for.
 */
import { prisma } from "./db";
import type { Department } from "@prisma/client";

export interface ReportData {
  days: number;
  totals: {
    leads: number; sent: number; opened: number; clicked: number; replied: number; suppressed: number;
    /** Inbound mail from a known contact that did NOT answer a campaign send.
     *  Counted separately so tightening the reply definition surfaces this
     *  traffic rather than losing it. */
    inbound: number;
  };
  rates: { open: number; click: number; reply: number }; // percentages 0–100
  funnel: { stage: string; count: number }[];
  series: { date: string; sent: number; opened: number; clicked: number; replied: number }[];
  byCampaign: { id: string; name: string; enrolled: number; sent: number; opened: number; replied: number }[];
}

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export async function getReport(orgId: string, days = 30): Promise<ReportData> {
  const since = new Date(Date.now() - days * DAY);

  const [leads, messages, activities, stageGroups, campaigns, suppressed] = await Promise.all([
    prisma.lead.count({ where: { organizationId: orgId } }),
    prisma.message.findMany({
      where: { organizationId: orgId, sentAt: { gte: since } },
      select: { sentAt: true, campaignId: true },
    }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId, at: { gte: since }, type: { in: ["opened", "clicked", "replied", "inbound"] } },
      select: { at: true, type: true, messageId: true, campaignId: true },
    }),
    prisma.lead.groupBy({ by: ["stage"], where: { organizationId: orgId }, _count: { _all: true } }),
    prisma.campaign.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, _count: { select: { enrollments: true } } },
    }),
    prisma.suppression.count({ where: { organizationId: orgId } }),
  ]);

  const openedMsgs = new Set(activities.filter((a) => a.type === "opened" && a.messageId).map((a) => a.messageId));
  const clickedMsgs = new Set(activities.filter((a) => a.type === "clicked" && a.messageId).map((a) => a.messageId));
  // "replied" is now only ever written for a VERIFIED reply — one whose
  // In-Reply-To/References names a message we sent (lib/inbox/store.ts). Mail
  // from a known contact that starts a new thread lands in `inbound` instead, so
  // the reply rate finally means what it says.
  const repliedCount = activities.filter((a) => a.type === "replied").length;
  const inboundCount = activities.filter((a) => a.type === "inbound").length;
  const sent = messages.length;

  // Time series (fill every day in the window).
  const buckets = new Map<string, { sent: number; opened: number; clicked: number; replied: number }>();
  for (let i = 0; i <= days; i++) buckets.set(dayKey(new Date(since.getTime() + i * DAY)), { sent: 0, opened: 0, clicked: 0, replied: 0 });
  for (const m of messages) if (m.sentAt) { const b = buckets.get(dayKey(m.sentAt)); if (b) b.sent++; }
  for (const a of activities) {
    const b = buckets.get(dayKey(a.at));
    if (!b) continue;
    if (a.type === "opened") b.opened++;
    else if (a.type === "clicked") b.clicked++;
    else if (a.type === "replied") b.replied++;
  }
  const series = Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));

  // Per-campaign breakdown.
  const byCampaign = campaigns.map((c) => {
    const cSent = messages.filter((m) => m.campaignId === c.id).length;
    const cOpened = new Set(activities.filter((a) => a.type === "opened" && a.campaignId === c.id && a.messageId).map((a) => a.messageId)).size;
    const cReplied = activities.filter((a) => a.type === "replied" && a.campaignId === c.id).length;
    return { id: c.id, name: c.name, enrolled: c._count.enrollments, sent: cSent, opened: cOpened, replied: cReplied };
  }).sort((a, b) => b.sent - a.sent);

  return {
    days,
    totals: { leads, sent, opened: openedMsgs.size, clicked: clickedMsgs.size, replied: repliedCount, suppressed, inbound: inboundCount },
    rates: { open: pct(openedMsgs.size, sent), click: pct(clickedMsgs.size, sent), reply: pct(repliedCount, sent) },
    funnel: stageGroups.map((g) => ({ stage: g.stage, count: g._count._all })),
    series,
    byCampaign,
  };
}

export interface PipelineFunnel {
  pipelineId: string;
  pipelineName: string;
  department: Department;
  stages: { name: string; position: number; kind: string; count: number }[];
}

/** Per-department pipeline funnel — where contacts actually sit, stage by stage. */
export async function getPipelineFunnels(orgId: string, department?: Department): Promise<PipelineFunnel[]> {
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: orgId, archivedAt: null, ...(department && { department }) },
    orderBy: { createdAt: "asc" },
    include: {
      stages: {
        orderBy: { position: "asc" },
        select: { name: true, position: true, kind: true, _count: { select: { items: true } } },
      },
    },
  });
  return pipelines.map((p) => ({
    pipelineId: p.id,
    pipelineName: p.name,
    department: p.department,
    stages: p.stages.map((s) => ({ name: s.name, position: s.position, kind: s.kind, count: s._count.items })),
  }));
}

export interface SourceRoi {
  sourceId: string;
  key: string;
  label: string;
  monthlyCost: number | null;
  totalItems: number;
  wonItems: number;
  wonValue: number;
  /** Monthly cost divided by wins — null when cost or wins aren't both known. */
  costPerWon: number | null;
}

/** Cost-per-source vs. conversion (product PRD §8) — is a source actually paying for itself. */
export async function getSourceRoi(orgId: string): Promise<SourceRoi[]> {
  const [sources, items] = await Promise.all([
    prisma.leadSource.findMany({ where: { organizationId: orgId }, select: { id: true, key: true, label: true, monthlyCost: true } }),
    prisma.pipelineItem.findMany({
      where: { organizationId: orgId, sourceId: { not: null } },
      select: { sourceId: true, value: true, stage: { select: { kind: true } } },
    }),
  ]);

  return sources
    .map((s) => {
      const rows = items.filter((i) => i.sourceId === s.id);
      const won = rows.filter((i) => i.stage.kind === "won");
      const wonValue = won.reduce((n, i) => n + (i.value ? Number(i.value) : 0), 0);
      const monthlyCost = s.monthlyCost ? Number(s.monthlyCost) : null;
      return {
        sourceId: s.id,
        key: s.key,
        label: s.label,
        monthlyCost,
        totalItems: rows.length,
        wonItems: won.length,
        wonValue,
        costPerWon: monthlyCost && won.length > 0 ? Math.round((monthlyCost / won.length) * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.totalItems - a.totalItems);
}

export interface ResponseLeaderboardRow {
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string;
  itemsRespondedTo: number;
  avgResponseHours: number;
}

/**
 * Per-rep response-time leaderboard: hours from a contact entering a pipeline to the
 * first human-driven (`actorKind: "user"`) stage move on it. Fastest first.
 */
export async function getResponseLeaderboard(orgId: string, days = 30): Promise<ResponseLeaderboardRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const items = await prisma.pipelineItem.findMany({
    where: { organizationId: orgId, createdAt: { gte: since }, ownerId: { not: null } },
    select: {
      ownerId: true,
      createdAt: true,
      transitions: { where: { actorKind: "user" }, orderBy: { at: "asc" }, take: 1, select: { at: true } },
    },
  });

  const byOwner = new Map<string, { totalHours: number; count: number }>();
  for (const item of items) {
    const first = item.transitions[0];
    if (!first || !item.ownerId) continue;
    const hours = (first.at.getTime() - item.createdAt.getTime()) / 3_600_000;
    if (hours < 0) continue;
    const cur = byOwner.get(item.ownerId) ?? { totalHours: 0, count: 0 };
    cur.totalHours += hours;
    cur.count += 1;
    byOwner.set(item.ownerId, cur);
  }

  const ownerIds = [...byOwner.keys()];
  const users = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return ownerIds
    .map((id) => {
      const { totalHours, count } = byOwner.get(id)!;
      const u = userById.get(id);
      return {
        ownerId: id,
        ownerName: u?.name ?? null,
        ownerEmail: u?.email ?? "",
        itemsRespondedTo: count,
        avgResponseHours: Math.round((totalHours / count) * 10) / 10,
      };
    })
    .sort((a, b) => a.avgResponseHours - b.avgResponseHours);
}

// ---------------------------------------------------------------------------
// Team performance — the owner's view of who is doing what.
// ---------------------------------------------------------------------------

export interface TeamMemberPerformance {
  userId: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  leads: number;
  outreach: number;
  replies: number;
  /** Percentage 0–100. Replies over messages sent, not over contacts. */
  replyRate: number;
  tasksDue: number;
}

/**
 * Per-member totals for the workspace overview.
 *
 * Deliberately a handful of grouped queries rather than a loop over members: a
 * twenty-person team would otherwise cost eighty round trips to render one
 * table, and this sits on the dashboard's critical path.
 *
 * A member's numbers follow the *contact*, not the message: `Message` has no
 * owner column, so outreach and replies are attributed through the lead's
 * `ownerId`. That means reassigning a contact moves its history with it, which
 * is the behaviour a manager expects when they hand an account to somebody else.
 */
export async function getTeamPerformance(orgId: string, days = 30, userIds?: string[] | null): Promise<TeamMemberPerformance[]> {
  const since = new Date(Date.now() - days * DAY);

  const members = await prisma.member.findMany({
    where: { organizationId: orgId, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: {
      userId: true,
      role: true,
      department: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (members.length === 0) return [];

  const ids = members.map((m) => m.userId);

  const [leadGroups, ownedLeads, taskGroups] = await Promise.all([
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: { organizationId: orgId, ownerId: { in: ids } },
      _count: { _all: true },
    }),
    // Needed to map messages/activities back to an owner, since neither table
    // carries one.
    prisma.lead.findMany({
      where: { organizationId: orgId, ownerId: { in: ids } },
      select: { id: true, ownerId: true },
    }),
    prisma.task.groupBy({
      by: ["ownerId"],
      where: { organizationId: orgId, ownerId: { in: ids }, status: "open" },
      _count: { _all: true },
    }),
  ]);

  const ownerByLead = new Map(ownedLeads.map((l) => [l.id, l.ownerId!]));
  const leadIds = [...ownerByLead.keys()];

  const [messages, replies] = leadIds.length
    ? await Promise.all([
        prisma.message.groupBy({
          by: ["leadId"],
          where: { organizationId: orgId, leadId: { in: leadIds }, status: { in: ["sent", "delivered"] }, sentAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.activityLog.groupBy({
          by: ["leadId"],
          where: { organizationId: orgId, leadId: { in: leadIds }, type: "replied", at: { gte: since } },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const sum = (rows: { leadId: string; _count: { _all: number } }[]) => {
    const out = new Map<string, number>();
    for (const r of rows) {
      const owner = ownerByLead.get(r.leadId);
      if (!owner) continue;
      out.set(owner, (out.get(owner) ?? 0) + r._count._all);
    }
    return out;
  };

  const outreachBy = sum(messages as { leadId: string; _count: { _all: number } }[]);
  const repliesBy = sum(replies as { leadId: string; _count: { _all: number } }[]);
  const leadsBy = new Map(leadGroups.map((g) => [g.ownerId!, g._count._all]));
  const tasksBy = new Map(taskGroups.map((g) => [g.ownerId!, g._count._all]));

  return members.map((m) => {
    const outreach = outreachBy.get(m.userId) ?? 0;
    const replied = repliesBy.get(m.userId) ?? 0;
    return {
      userId: m.userId,
      name: m.user?.name || m.user?.email || "Unknown",
      email: m.user?.email ?? "",
      role: m.role,
      department: m.department,
      leads: leadsBy.get(m.userId) ?? 0,
      outreach,
      replies: replied,
      replyRate: pct(replied, outreach),
      tasksDue: tasksBy.get(m.userId) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// LinkedIn — invitations sent, and how many were actually accepted.
// ---------------------------------------------------------------------------

export interface LinkedInReport {
  invitesSent: number;
  accepted: number;
  /** Percentage 0–100 of this window's invitations accepted so far. */
  acceptanceRate: number;
  /** Sent in the window and not accepted yet. */
  awaiting: number;
  /** Skipped because they were already a connection — not an acceptance. */
  alreadyConnected: number;
  failed: number;
  messagesSent: number;
  /** In the queue right now, whatever the window. */
  queued: number;
  byCampaign: { id: string | null; name: string; sent: number; accepted: number; rate: number }[];
  series: { date: string; sent: number; accepted: number }[];
}

/**
 * LinkedIn numbers from what happened, not from what was queued.
 *
 * "Sent" is an invitation the desktop app confirmed on the page. "Accepted" is
 * one whose person has since appeared in the connections list — LinkedIn reports
 * acceptances nowhere else (see recordConnectionsSeen in lib/linkedin/queue.ts),
 * so this undercounts rather than guesses: an acceptance nobody has looked for
 * yet still reads as awaiting.
 *
 * Reports had no LinkedIn section at all before this; a LinkedIn step counted as
 * a generic "sent", and an accepted invitation was never recorded anywhere.
 */
export async function getLinkedInReport(orgId: string, days = 30): Promise<LinkedInReport> {
  const since = new Date(Date.now() - days * DAY);
  // Rows from before `kind` existed read as the desktop app treated them.
  const invites = { OR: [{ kind: "invite" }, { kind: null, type: { not: "message" } }] };

  const [sent, alreadyConnected, failed, messagesSent, queued] = await Promise.all([
    // Invitations are few — LinkedIn allows about twenty a day per account — so
    // the window's rows are read and grouped here, which gives the per-campaign
    // and per-day splits from one query.
    prisma.linkedInAction.findMany({
      where: { AND: [invites, { organizationId: orgId, status: "sent", sentAt: { gte: since } }] },
      select: { campaignId: true, sentAt: true, acceptedAt: true },
    }),
    prisma.linkedInAction.count({
      where: {
        AND: [invites, { organizationId: orgId, status: "skipped", result: { startsWith: "already connected" }, updatedAt: { gte: since } }],
      },
    }),
    prisma.linkedInAction.count({ where: { organizationId: orgId, status: "failed", updatedAt: { gte: since } } }),
    prisma.linkedInAction.count({ where: { organizationId: orgId, status: "sent", kind: "message", sentAt: { gte: since } } }),
    prisma.linkedInAction.count({ where: { organizationId: orgId, status: { in: ["pending", "in_progress", "drafted"] } } }),
  ]);

  const accepted = sent.filter((a) => a.acceptedAt).length;

  const campaignIds = [...new Set(sent.map((a) => a.campaignId).filter((v): v is string => !!v))];
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true, archivedAt: true } })
    : [];
  const nameOf = new Map(campaigns.map((c) => [c.id, c.archivedAt ? `${c.name} (deleted)` : c.name]));

  const perCampaign = new Map<string, { id: string | null; name: string; sent: number; accepted: number }>();
  for (const a of sent) {
    const key = a.campaignId ?? "";
    const row = perCampaign.get(key) ?? {
      id: a.campaignId,
      // No campaign means the bulk "Connect on LinkedIn" on the Leads screen.
      name: a.campaignId ? (nameOf.get(a.campaignId) ?? "Deleted campaign") : "From the Leads screen",
      sent: 0,
      accepted: 0,
    };
    row.sent++;
    if (a.acceptedAt) row.accepted++;
    perCampaign.set(key, row);
  }

  const buckets = new Map<string, { sent: number; accepted: number }>();
  for (let i = 0; i <= days; i++) buckets.set(dayKey(new Date(since.getTime() + i * DAY)), { sent: 0, accepted: 0 });
  for (const a of sent) {
    const s = a.sentAt && buckets.get(dayKey(a.sentAt));
    if (s) s.sent++;
    const acc = a.acceptedAt && buckets.get(dayKey(a.acceptedAt));
    if (acc) acc.accepted++;
  }

  return {
    invitesSent: sent.length,
    accepted,
    acceptanceRate: pct(accepted, sent.length),
    awaiting: sent.length - accepted,
    alreadyConnected,
    failed,
    messagesSent,
    queued,
    byCampaign: [...perCampaign.values()].map((r) => ({ ...r, rate: pct(r.accepted, r.sent) })).sort((a, b) => b.sent - a.sent),
    series: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
  };
}
