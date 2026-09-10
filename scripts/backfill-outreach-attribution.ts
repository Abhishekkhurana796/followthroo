/**
 * Fill the attribution columns added on 2026-09-10, for rows written before them.
 *
 *   npx tsx --env-file=.env scripts/backfill-outreach-attribution.ts --dry-run
 *   npx tsx --env-file=.env scripts/backfill-outreach-attribution.ts --yes
 *
 * Each step only fills what is still empty, so re-running costs nothing and never
 * overwrites a value recorded at write time:
 *
 *   1. LinkedInAction.kind, from `type` the way the desktop app reads it —
 *      "message" is a message; "invite" and "auto" are invitations.
 *   2. Message.kind for LinkedIn invitations. A sent invitation was also written
 *      as a Message, which now defaults to "message"; it is marked "invite" when
 *      a sent invitation for the same lead went out within the same two minutes.
 *   3. InboxMessage.campaignId — inbound, from In-Reply-To/References naming a
 *      Message we sent; outbound, from the Message with the same RFC Message-ID.
 *
 * What it cannot do: mark old invitations accepted. Nothing was recorded when
 * that happened. They read "accepted" once the person turns up in a connections
 * list, like any other.
 */
import { prisma } from "../lib/db";
import { parseMessageIds } from "../lib/inbox/threading";

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--yes");

async function main() {
  if (!dryRun && !confirmed) {
    console.error("Refusing to write without --yes. Preview with --dry-run first.");
    process.exit(1);
  }

  // ---- 1. LinkedInAction.kind ------------------------------------------------
  const asMessage = { kind: null, type: "message" };
  const asInvite = { kind: null, type: { not: "message" } };
  const [nMessage, nInvite] = await Promise.all([
    prisma.linkedInAction.count({ where: asMessage }),
    prisma.linkedInAction.count({ where: asInvite }),
  ]);
  console.log(`1. LinkedIn actions with no kind: ${nInvite} invitation(s), ${nMessage} message(s).`);
  if (!dryRun) {
    await prisma.linkedInAction.updateMany({ where: asMessage, data: { kind: "message" } });
    await prisma.linkedInAction.updateMany({ where: asInvite, data: { kind: "invite" } });
  }

  // ---- 2. Message.kind for LinkedIn invitations -------------------------------
  const invites = await prisma.linkedInAction.findMany({
    where: { status: "sent", sentAt: { not: null }, OR: [{ kind: "invite" }, { kind: null, type: { not: "message" } }] },
    select: { leadId: true, sentAt: true },
  });
  let invitationMessages = 0;
  for (const a of invites) {
    const at = a.sentAt!.getTime();
    const where = {
      leadId: a.leadId,
      channel: "linkedin" as const,
      status: "sent" as const,
      kind: "message",
      sentAt: { gte: new Date(at - 120_000), lte: new Date(at + 120_000) },
    };
    if (dryRun) invitationMessages += await prisma.message.count({ where });
    else invitationMessages += (await prisma.message.updateMany({ where, data: { kind: "invite" } })).count;
  }
  console.log(`2. LinkedIn invitations recorded as messages: ${invitationMessages}.`);

  // ---- 3. InboxMessage.campaignId ---------------------------------------------
  const inbound = await prisma.inboxMessage.findMany({
    where: { direction: "inbound", campaignId: null, matchKind: { in: ["header", "thread"] } },
    select: { id: true, organizationId: true, inReplyTo: true, references: true },
  });
  let inboundTagged = 0;
  for (const m of inbound) {
    const ids = [...new Set([...parseMessageIds(m.inReplyTo), ...m.references])];
    if (!ids.length) continue;
    const sent = await prisma.message.findFirst({
      where: { organizationId: m.organizationId, rfcMessageId: { in: ids.map((id) => `<${id}>`) }, campaignId: { not: null } },
      select: { id: true, campaignId: true },
      orderBy: { createdAt: "desc" },
    });
    if (!sent) continue;
    inboundTagged++;
    if (!dryRun) {
      await prisma.inboxMessage.update({
        where: { id: m.id },
        data: { campaignId: sent.campaignId, inReplyToMessageId: sent.id },
      });
    }
  }

  const outbound = await prisma.inboxMessage.findMany({
    where: { direction: "outbound", campaignId: null, rfcMessageId: { not: null } },
    select: { id: true, organizationId: true, rfcMessageId: true },
  });
  let outboundTagged = 0;
  for (const m of outbound) {
    const sent = await prisma.message.findFirst({
      where: { organizationId: m.organizationId, rfcMessageId: m.rfcMessageId, campaignId: { not: null } },
      select: { campaignId: true },
    });
    if (!sent) continue;
    outboundTagged++;
    if (!dryRun) await prisma.inboxMessage.update({ where: { id: m.id }, data: { campaignId: sent.campaignId } });
  }
  console.log(`3. Inbox messages traced to a campaign: ${inboundTagged} replies, ${outboundTagged} sends.`);

  console.log(dryRun ? "Dry run — nothing written." : "Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
