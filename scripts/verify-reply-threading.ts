/**
 * Verification for RFC-822 reply attribution (lib/inbox/store.ts).
 *
 * The behaviour this proves is the whole point of the change:
 *   - a mail that quotes our Message-ID is a reply, stops the sequence, and is
 *     attributed to the campaign that sent it;
 *   - a brand-new mail from the SAME contact, with no threading headers, is not
 *     a reply, does not stop the sequence, and still shows up in the inbox.
 *
 * Runs against the real database in a throwaway organisation, which it deletes.
 *
 *   npx tsx --env-file=.env.local scripts/verify-reply-threading.ts
 */
import { prisma } from "../lib/db";
import { recordInbound, recordOutbound } from "../lib/inbox/store";
import { buildRfcMessageId, parseMessageIds, extractHeader, normalizeMessageId } from "../lib/inbox/threading";
import { randomUUID } from "node:crypto";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string, extra = "") => {
  if (c) {
    pass++;
    console.log("  ok  ", m, extra);
  } else {
    fail++;
    console.log("  FAIL", m, extra);
  }
};

async function main() {
  // ---- pure helpers -------------------------------------------------------
  ok(normalizeMessageId("  <ABC@x.com> ") === "abc@x.com", "normalizeMessageId strips brackets and cases");
  ok(parseMessageIds("<a@x> <b@x>").join(",") === "a@x,b@x", "parseMessageIds reads a chain");
  ok(parseMessageIds(null).length === 0, "parseMessageIds tolerates a missing header");
  ok(parseMessageIds("<a@x> <a@x>").length === 1, "parseMessageIds de-duplicates");
  ok(
    buildRfcMessageId("abc", "https://mail.acme.com/x") === "<abc@mail.acme.com>",
    "buildRfcMessageId cleans the domain"
  );
  const folded = "References: <a@x>\r\n <b@x>\r\n\t<c@x>\r\nSubject: hi\r\n";
  ok(
    parseMessageIds(extractHeader(Buffer.from(folded), "references")).join(",") === "a@x,b@x,c@x",
    "extractHeader unfolds a wrapped References chain"
  );

  // ---- the real thing -----------------------------------------------------
  const stamp = Date.now();
  const org = await prisma.organization.create({
    data: { name: "reply-test", slug: `reply-test-${stamp}` },
  });
  const orgId = org.id;
  const leadEmail = `contact-${stamp}@example.com`;
  const lead = await prisma.lead.create({
    data: { organizationId: orgId, firstName: "Rahul", email: leadEmail, stage: "new" },
  });
  const campaign = await prisma.campaign.create({
    data: { organizationId: orgId, name: "Recruitment partnership", status: "active" },
  });

  // A campaign send, with the Message-ID we would really have put on the wire.
  const messageId = randomUUID();
  const rfcMessageId = buildRfcMessageId(messageId, "outreach.acme.com");
  await prisma.message.create({
    data: {
      id: messageId,
      organizationId: orgId,
      leadId: lead.id,
      campaignId: campaign.id,
      channel: "email",
      renderedSubject: "Recruitment partnership opportunity",
      renderedBody: "Hi Rahul,",
      status: "sent",
      providerId: "smtp-1",
      rfcMessageId,
      idempotencyKey: randomUUID(),
      sentAt: new Date(),
    },
  });
  await recordOutbound(orgId, {
    leadId: lead.id,
    toAddr: leadEmail,
    subject: "Recruitment partnership opportunity",
    body: "Hi Rahul,",
    providerMessageId: "smtp-1",
    rfcMessageId,
  });

  // 1. A genuine in-thread reply.
  const reply = await recordInbound(orgId, {
    fromAddr: leadEmail,
    subject: "Re: Recruitment partnership opportunity",
    body: "Yes, interested — can we talk Tuesday?",
    providerMessageId: "inbound-1",
    rfcMessageId: "<reply-1@example.com>",
    inReplyTo: rfcMessageId,
  });
  ok(reply.matchKind === "header", "in-thread reply matches on headers", `(got ${reply.matchKind})`);
  ok(reply.campaignId === campaign.id, "reply is attributed to the campaign that sent it");
  ok(reply.repliedToMessageId === messageId, "reply is attributed to the exact message");

  const afterReply = await prisma.lead.findUnique({ where: { id: lead.id } });
  ok(afterReply?.stage === "replied", "a verified reply moves the lead to replied");

  const repliedActivity = await prisma.activityLog.findFirst({
    where: { organizationId: orgId, leadId: lead.id, type: "replied" },
  });
  ok(!!repliedActivity, "a verified reply writes ActivityLog(replied) — what halts the sequence");
  ok(repliedActivity?.campaignId === campaign.id, "the activity carries campaignId, so per-campaign reply rate is not always zero");

  // 2. The case that used to break everything: a NEW mail from the same person.
  await prisma.lead.update({ where: { id: lead.id }, data: { stage: "new" } });
  const fresh = await recordInbound(orgId, {
    fromAddr: leadEmail,
    subject: "Can you send me your company profile?",
    body: "Hi, unrelated question — do you have a profile deck?",
    providerMessageId: "inbound-2",
    rfcMessageId: "<fresh-1@example.com>",
    // No In-Reply-To, no References. A new thread.
  });
  ok(fresh.matchKind === "address", "a fresh mail from a known contact matches by address only", `(got ${fresh.matchKind})`);
  ok(fresh.matched, "it is still tied to the contact and appears in the inbox");

  const afterFresh = await prisma.lead.findUnique({ where: { id: lead.id } });
  ok(afterFresh?.stage === "new", "a fresh mail does NOT move the lead to replied");

  const inboundActivity = await prisma.activityLog.findFirst({
    where: { organizationId: orgId, leadId: lead.id, type: "inbound" },
  });
  ok(!!inboundActivity, "it is logged as `inbound`, not `replied`, so the sequence keeps running");

  const repliedCount = await prisma.activityLog.count({
    where: { organizationId: orgId, leadId: lead.id, type: "replied" },
  });
  ok(repliedCount === 1, "still exactly one reply on record, not two", `(got ${repliedCount})`);

  // 3. Reply deep in a thread — our id is in References, not In-Reply-To.
  const deep = await recordInbound(orgId, {
    fromAddr: `assistant-${stamp}@example.com`, // a different address entirely
    subject: "Re: Recruitment partnership opportunity",
    body: "Copying my assistant.",
    providerMessageId: "inbound-3",
    rfcMessageId: "<deep-1@example.com>",
    references: `<something-else@x.com> ${rfcMessageId} <reply-1@example.com>`,
  });
  ok(deep.matchKind === "header", "a reply from a DIFFERENT address still matches via References", `(got ${deep.matchKind})`);
  ok(deep.campaignId === campaign.id, "and is still attributed to the right campaign");

  // 4. Unknown sender, no headers.
  const stranger = await recordInbound(orgId, {
    fromAddr: `stranger-${stamp}@nowhere.com`,
    subject: "Hello",
    body: "Who are you?",
    providerMessageId: "inbound-4",
  });
  ok(stranger.matchKind === "none", "an unknown sender matches nothing");
  ok(stranger.recorded && !stranger.matched, "but is still recorded rather than dropped");

  // 5. Idempotence — polling twice must not double-count.
  const again = await recordInbound(orgId, {
    fromAddr: leadEmail,
    subject: "Re: Recruitment partnership opportunity",
    providerMessageId: "inbound-1",
    inReplyTo: rfcMessageId,
  });
  ok(!again.recorded, "re-polling the same message is a no-op");

  // cleanup
  await prisma.inboxMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.inboxThread.deleteMany({ where: { organizationId: orgId } });
  await prisma.activityLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversationEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.task.deleteMany({ where: { organizationId: orgId } });
  await prisma.message.deleteMany({ where: { organizationId: orgId } });
  await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
