/**
 * Enroll leads into a campaign. Creates one Enrollment per lead (idempotent per
 * (campaign, lead)) and enqueues the first advance. Targeted enrollment (a group/segment,
 * a checkbox selection, or a single lead) all funnel through here.
 */
import { prisma } from "./db";
import { normalizeSequence, scheduleAdvance } from "./campaign-engine";

export interface EnrollResult {
  launched: string;
  enrolled: number;
  skipped: number;
  enqueued: number;
  queueAvailable: boolean;
}

export async function enrollLeads(
  orgId: string,
  campaignId: string,
  leadIds: string[]
): Promise<EnrollResult | { error: string; status: number }> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId: orgId } });
  if (!campaign) return { error: "campaign not found", status: 404 };
  // Enrolling would flip a deleted campaign back to active and start sending
  // from something that no longer appears anywhere in the app.
  if (campaign.archivedAt) return { error: "This campaign was deleted.", status: 410 };

  const graph = normalizeSequence(campaign.sequence);
  if (!graph.startNodeId) return { error: "campaign has no sequence", status: 400 };
  const startNode = graph.nodes[graph.startNodeId];

  // Only enroll leads that belong to this org (never a foreign tenant's lead).
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, organizationId: orgId },
    select: { id: true },
  });
  if (leads.length === 0) return { error: "no matching leads in this organization", status: 400 };

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "active" } });

  let enrolled = 0;
  let skipped = 0;
  let enqueued = 0;
  let queueAvailable = true;

  for (const lead of leads) {
    const existing = await prisma.enrollment.findUnique({
      where: { campaignId_leadId: { campaignId, leadId: lead.id } },
    });
    if (existing) {
      skipped++;
      continue;
    }
    const enr = await prisma.enrollment.create({
      data: {
        organizationId: orgId,
        campaignId,
        leadId: lead.id,
        status: "active",
        currentNodeId: graph.startNodeId,
      },
    });
    enrolled++;
    const ok = await scheduleAdvance(enr.id, startNode);
    if (ok) {
      enqueued++;
    } else {
      // Nothing was queued, but scheduleAdvance already wrote a future nextRunAt. Pull it
      // into the past so the enrollment sweep recovers this lead instead of stranding it.
      await prisma.enrollment.update({
        where: { id: enr.id },
        data: { nextRunAt: new Date(Date.now() - 1000) },
      });
      queueAvailable = false;
    }
  }

  return { launched: campaign.id, enrolled, skipped, enqueued, queueAvailable };
}
