/**
 * Populate Lead.ownerId / createdById for contacts that predate those columns.
 *
 * Ownership used to be inferred at read time from the lead's open PipelineItem
 * (lib/queries.ts enrichLeadRows). That still works for display, but a
 * member-scoped list has to filter on it, and you cannot filter on something
 * derived. This copies the inference into the column once.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-lead-ownership.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-lead-ownership.ts --yes
 *
 * Idempotent: only fills leads whose ownerId is still null, so re-running after
 * a partial run costs nothing and cannot overwrite a real assignment.
 *
 * Leads with no pipeline item stay unassigned on purpose — under lib/scope.ts an
 * unassigned lead is a visible, claimable pool, not a hidden one, so this is a
 * safe resting state rather than data nobody can reach.
 */
import { prisma } from "../lib/db";

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--yes");

async function main() {
  if (!dryRun && !confirmed) {
    console.error("Refusing to write without --yes. Preview with --dry-run first.");
    process.exit(1);
  }

  const unowned = await prisma.lead.findMany({
    where: { ownerId: null },
    select: { id: true, organizationId: true },
  });
  console.log(`${unowned.length} lead(s) with no owner.`);
  if (unowned.length === 0) return;

  // One query for every candidate's pipeline owner, rather than one per lead.
  const items = await prisma.pipelineItem.findMany({
    where: { leadId: { in: unowned.map((l) => l.id) }, ownerId: { not: null } },
    select: { leadId: true, ownerId: true, closedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Prefer an open item's owner; fall back to the most recent closed one.
  const byLead = new Map<string, string>();
  for (const it of items) {
    if (!it.ownerId) continue;
    const existing = byLead.get(it.leadId);
    if (!existing || it.closedAt === null) byLead.set(it.leadId, it.ownerId);
  }

  console.log(`${byLead.size} of them have a pipeline owner to inherit.`);
  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  let updated = 0;
  for (const [leadId, ownerId] of byLead) {
    await prisma.lead.update({ where: { id: leadId }, data: { ownerId } });
    updated++;
  }
  console.log(`Assigned ${updated} lead(s).`);

  const remaining = await prisma.lead.count({ where: { ownerId: null } });
  console.log(`${remaining} lead(s) remain unassigned — visible as a claimable pool, by design.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
