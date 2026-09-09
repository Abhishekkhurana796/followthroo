/**
 * Verification for LinkedIn as a campaign step.
 *
 *   npx tsx --env-file=.env.local scripts/verify-linkedin-campaign-steps.ts
 *
 * Three bugs made this file necessary, and each had the same shape: the code
 * looked right, did nothing, and said nothing.
 *
 *   1. `lib/channels/linkedin.ts` enqueued every action without a campaignId or
 *      a type, so per-campaign caps applied to nothing and every action was
 *      "auto".
 *   2. `claimActions` read `settings?.mode || account.mode || a.type`, and since
 *      LinkedInAccount.mode defaults to the non-empty string "auto",
 *      `account.mode` always won and the action's own type was unreachable.
 *      A step-level invite/message choice would have been a silent no-op.
 *   3. A queued LinkedIn action was recorded as a `sent` Message, and
 *      `completeAction` wrote a second one — double-counting every step.
 *
 * So the assertions below are deliberately about what reaches the database and
 * what the extension is finally told, not about whether a function returns
 * without throwing.
 */
import { prisma } from "../lib/db";
import { linkedinActionFor, SendNode, normalizeSequence, validateSequence } from "../lib/campaign-engine";
import { linkedinChannel } from "../lib/channels/linkedin";
import { claimActions } from "../lib/linkedin/queue";
import { INVITE_NOTE_MAX, worstCaseNoteLength } from "../lib/linkedin/note";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) {
    pass++;
    console.log("  ok  ", m);
  } else {
    fail++;
    console.log("  FAIL", m);
  }
};

async function main() {
  const stamp = Date.now();
  const org = await prisma.organization.create({
    data: { name: `li-steps-${stamp}`, slug: `li-steps-${stamp}` },
  });

  try {
    console.log("\n— the node schema —");
    {
      const legacy = SendNode.safeParse({ id: "n0", type: "send", channel: "linkedin", waitDays: 0 });
      ok(legacy.success, "a campaign built before LinkedIn steps existed still parses");
      ok(
        legacy.success && linkedinActionFor(legacy.data) === "auto",
        "…and resolves to auto, which is what it already did",
      );

      const invite = SendNode.safeParse({
        id: "n1",
        type: "send",
        channel: "linkedin",
        linkedinAction: "invite",
        waitDays: 0,
      });
      ok(invite.success && linkedinActionFor(invite.data) === "invite", "an explicit invite step parses and resolves");

      ok(
        !SendNode.safeParse({ id: "n2", type: "send", channel: "linkedin", linkedinAction: "shout" }).success,
        "an unknown action kind is refused",
      );

      // The round trip is where linkedinAction would silently vanish.
      const graph = normalizeSequence({
        nodes: [{ id: "n0", type: "send", channel: "linkedin", linkedinAction: "message", waitDays: 0 }],
      });
      ok(
        linkedinActionFor(graph.nodes["n0"]) === "message",
        "normalizeSequence carries the kind through rather than dropping it",
      );
    }

    console.log("\n— the note ceiling —");
    {
      ok(worstCaseNoteLength("hello") === 5, "plain text measures as itself");
      ok(
        worstCaseNoteLength("Hi {{firstName}}") > "Hi {{firstName}}".length - 15,
        "a variable is priced at what it might render to, not at zero",
      );
      ok(
        worstCaseNoteLength("x".repeat(280) + "{{company}}") > INVITE_NOTE_MAX,
        "a note that only fits when every variable is empty is caught",
      );
    }

    console.log("\n— a step becomes a queued action —");
    const lead = await prisma.lead.create({
      data: {
        organizationId: org.id,
        firstName: "Verify",
        lastName: "Person",
        linkedinUrl: `https://www.linkedin.com/in/verify-${stamp}`,
      },
    });
    const campaign = await prisma.campaign.create({
      data: { organizationId: org.id, name: `li-camp-${stamp}`, status: "active", sequence: [] },
    });
    const leadArg = { id: lead.id, linkedinUrl: lead.linkedinUrl, firstName: "Verify" };

    {
      const r = await linkedinChannel.send(leadArg, { body: "Let us connect." }, undefined, org.id, undefined, {
        campaignId: campaign.id,
        linkedinAction: "invite",
      });
      ok(r.ok === true, "an invite step queues an action");
      const row = await prisma.linkedInAction.findUnique({ where: { id: r.providerId! } });
      ok(row?.campaignId === campaign.id, "…carrying its campaignId (this was null for every campaign action)");
      ok(row?.type === "invite", "…and its kind, rather than a blanket 'auto'");
    }

    {
      const r = await linkedinChannel.send(leadArg, { body: "Following up." }, undefined, org.id, undefined, {
        campaignId: campaign.id,
        linkedinAction: "message",
      });
      const row = await prisma.linkedInAction.findUnique({ where: { id: r.providerId! } });
      ok(row?.type === "message", "a message step is stored as a message");
    }

    {
      const r = await linkedinChannel.send(leadArg, { body: "No kind given." }, undefined, org.id);
      const row = await prisma.linkedInAction.findUnique({ where: { id: r.providerId! } });
      ok(row?.type === "auto", "a send with no context still queues as auto");
    }

    console.log("\n— the note ceiling, at send time —");
    {
      const long = "x".repeat(INVITE_NOTE_MAX + 1);
      const before = await prisma.linkedInAction.count({ where: { organizationId: org.id } });
      const r = await linkedinChannel.send(leadArg, { body: long }, undefined, org.id, undefined, {
        campaignId: campaign.id,
        linkedinAction: "invite",
      });
      ok(r.ok === false, `an over-long invite note is refused rather than truncated (${r.error?.slice(0, 48)})`);
      ok(
        (await prisma.linkedInAction.count({ where: { organizationId: org.id } })) === before,
        "…and no action row is created for it",
      );

      const dm = await linkedinChannel.send(leadArg, { body: long }, undefined, org.id, undefined, {
        campaignId: campaign.id,
        linkedinAction: "message",
      });
      ok(dm.ok === true, "the same text is allowed as a direct message, which has no such limit");
    }

    console.log("\n— the campaign-save guard —");
    {
      const shortTpl = await prisma.template.create({
        data: { organizationId: org.id, name: `short-${stamp}`, channel: "linkedin", body: "Hi {{firstName}}, connecting." },
      });
      const longTpl = await prisma.template.create({
        data: { organizationId: org.id, name: `long-${stamp}`, channel: "linkedin", body: "x".repeat(290) + " {{company}}" },
      });

      const inviteWith = (templateId: string) => ({
        nodes: [{ id: "n0", type: "send", channel: "linkedin", linkedinAction: "invite", templateId, waitDays: 0 }],
      });

      let v = await validateSequence(org.id, inviteWith(shortTpl.id));
      ok(v.ok === true, "a note that fits is accepted");

      v = await validateSequence(org.id, inviteWith(longTpl.id));
      ok(v.ok === false, "a note that will not fit once personalised is refused at save");
      ok(v.ok === false && /Step 1/.test(v.message), "…and names the step, not an internal node id");

      v = await validateSequence(org.id, {
        nodes: [{ id: "n0", type: "send", channel: "linkedin", linkedinAction: "message", templateId: longTpl.id, waitDays: 0 }],
      });
      ok(v.ok === true, "the same template is fine on a message step");

      v = await validateSequence(org.id, {
        nodes: [{ id: "n0", type: "send", channel: "email", linkedinAction: "invite", waitDays: 0 }],
      });
      ok(v.ok === false, "a LinkedIn action on an email step is refused");

      // The template lookup is org-scoped; an unscoped `id: { in: [...] }` here
      // would read another tenant's wording.
      const other = await prisma.organization.create({ data: { name: `other-${stamp}`, slug: `other-${stamp}` } });
      const foreign = await prisma.template.create({
        data: { organizationId: other.id, name: `foreign-${stamp}`, channel: "linkedin", body: "hello" },
      });
      v = await validateSequence(org.id, inviteWith(foreign.id));
      ok(v.ok === false, "a template belonging to another workspace is refused, not read");
      await prisma.template.deleteMany({ where: { organizationId: other.id } });
      await prisma.organization.delete({ where: { id: other.id } }).catch(() => {});
    }

    console.log("\n— what the extension is finally told —");
    {
      // Re-assigned after every update: claimActions reads mode/settings off the
      // object it is given, so holding the row from create() would test stale memory.
      let account = await prisma.linkedInAccount.create({
        data: { organizationId: org.id, userId: `u-${stamp}`, extToken: `tok-${stamp}`, mode: "auto" },
      });

      await prisma.linkedInAction.updateMany({
        where: { organizationId: org.id },
        data: { status: "pending" },
      });

      let claimed = await claimActions(account, 10);

      // The link in the chain nothing asserted, and the one that broke: the
      // account's autoSend has to reach the extension on every claimed action.
      // It read false in production for days while the UI implied otherwise.
      ok(claimed.every((a) => a.autoSend === false), "autoSend defaults to false on every claimed action");

      const invite = claimed.find((a) => a.note === "Let us connect.");
      ok(invite?.type === "invite", "an invite survives account.mode = 'auto' (the precedence bug)");
      const message = claimed.find((a) => a.note === "Following up.");
      ok(message?.type === "message", "…and so does a message");

      // Per-campaign settings must not override an explicit step kind, but must
      // still steer the actions that never expressed one.
      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({
        where: { id: account.id },
        data: { mode: "message", campaignSettings: { [campaign.id]: { mode: "message" } } },
      });
      claimed = await claimActions(account, 10);
      ok(
        claimed.find((a) => a.note === "Let us connect.")?.type === "invite",
        "a campaign-level mode does not override the step's own instruction",
      );
      ok(
        claimed.find((a) => a.note === "No kind given.")?.type === "message",
        "…but it still steers an action that never said what it was",
      );

      console.log("\n— per-campaign controls reach campaign actions —");
      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({
        where: { id: account.id },
        data: { mode: "auto", campaignSettings: { [campaign.id]: { enabled: false } } },
      });
      claimed = await claimActions(account, 10);
      ok(
        !claimed.some((a) => a.campaignId === campaign.id),
        "disabling a campaign now actually suppresses its actions",
      );

      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({
        where: { id: account.id },
        data: { campaignSettings: {}, selectedCampaignIds: [`some-other-${stamp}`] },
      });
      claimed = await claimActions(account, 10);
      ok(
        !claimed.some((a) => a.campaignId === campaign.id),
        "a campaign left out of the selection is not drained",
      );

      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({ where: { id: account.id }, data: { selectedCampaignIds: [] } });
      claimed = await claimActions(account, 10);
      ok(claimed.some((a) => a.campaignId === campaign.id), "an empty selection still means 'all campaigns'");

      console.log("\n— autoSend reaches the extension —");
      //
      // Through the ROUTE, not just claimActions. The first version of this
      // asserted claimActions and passed while the feature did nothing, because
      // the route hand-picks the fields it returns and autoSend was not on the
      // list. What the extension actually receives is the only thing that counts.
      {
        await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
        await prisma.linkedInAccount.update({ where: { id: account.id }, data: { autoSend: true } });

        const { GET } = await import("../app/api/linkedin/queue/route");
        const { NextRequest } = await import("next/server");
        const res = await GET(
          new NextRequest(`https://example.invalid/api/linkedin/queue?limit=5`, {
            headers: { Authorization: `Bearer ${account.extToken}` },
          }),
        );
        const body = (await res.json()) as { data?: { actions?: { autoSend?: boolean }[] } };
        const served = body.data?.actions ?? [];
        ok(served.length > 0, "the queue endpoint serves actions");
        ok(
          served.every((a) => a.autoSend === true),
          "…and every one carries autoSend over the wire, not just out of claimActions",
        );
      }

      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({ where: { id: account.id }, data: { autoSend: true } });
      claimed = await claimActions(account, 10);
      ok(claimed.length > 0 && claimed.every((a) => a.autoSend === true), "turning it on reaches every claimed action");

      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({ where: { id: account.id }, data: { autoSend: false } });
      claimed = await claimActions(account, 10);
      ok(claimed.length > 0 && claimed.every((a) => a.autoSend === false), "turning it off reaches them too");
    }
  } finally {
    await prisma.linkedInAction.deleteMany({ where: { organizationId: org.id } });
    await prisma.linkedInAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.message.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.template.deleteMany({ where: { organizationId: org.id } });
    await prisma.campaign.deleteMany({ where: { organizationId: org.id } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
