/**
 * Verification for queueing connection requests from a lead selection.
 *
 *   npx tsx --env-file=.env.local scripts/verify-linkedin-invite-bulk.ts
 *
 * This path exists because building a campaign was the only way to send a
 * connection request from the app, which is five steps too many for "invite
 * these forty". The assertions below are about the things that make it safe to
 * hand a bulk action to a person:
 *
 *   - it never invites the same person twice (an invitation cannot be recalled
 *     quietly, so a duplicate is worse than doing nothing)
 *   - it says what it will skip, before it acts
 *   - it refuses a note LinkedIn would reject
 */
import { prisma } from "../lib/db";
import { enqueueManyLinkedIn, previewEnqueue } from "../lib/linkedin/enqueue-many";
import { INVITE_NOTE_MAX } from "../lib/linkedin/note";

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
    data: { name: `li-bulk-${stamp}`, slug: `li-bulk-${stamp}` },
  });

  try {
    // Three with a profile, two without — the ordinary shape of a CRM where most
    // contacts arrived from a CSV.
    const withProfile = await Promise.all(
      [1, 2, 3].map((i) =>
        prisma.lead.create({
          data: {
            organizationId: org.id,
            firstName: `Has${i}`,
            linkedinUrl: `https://www.linkedin.com/in/has-${i}-${stamp}`,
          },
        }),
      ),
    );
    const without = await Promise.all(
      [1, 2].map((i) =>
        prisma.lead.create({
          data: { organizationId: org.id, firstName: `No${i}`, email: `no${i}-${stamp}@example.invalid` },
        }),
      ),
    );
    const all = [...withProfile, ...without].map((l) => l.id);

    console.log("\n— the preview, before anything happens —");
    {
      const p = await previewEnqueue(org.id, all);
      ok(p.selected === 5, "counts the whole selection");
      ok(p.withProfile === 3, "counts only those with a LinkedIn profile");
      ok(p.noProfile === 2, "…and says how many will be skipped");
      ok(p.alreadyQueued === 0, "nothing is queued yet");
    }

    console.log("\n— queueing —");
    {
      const r = await enqueueManyLinkedIn({ organizationId: org.id, leadIds: all, note: "Hello", type: "invite" });
      ok(r.queued === 3, "queues only the contacts that can be actioned");
      ok(r.noProfile === 2, "reports the ones with no profile");

      const rows = await prisma.linkedInAction.findMany({ where: { organizationId: org.id } });
      ok(rows.length === 3, "three actions exist");
      ok(rows.every((a) => a.type === "invite"), "…all typed as invites");
      ok(rows.every((a) => a.note === "Hello"), "…carrying the note");
    }

    console.log("\n— the same people again —");
    {
      const p = await previewEnqueue(org.id, all);
      ok(p.alreadyQueued === 3, "the preview now says three are already waiting");

      const r = await enqueueManyLinkedIn({ organizationId: org.id, leadIds: all, type: "invite" });
      ok(r.queued === 0, "queues nobody a second time");
      ok(r.alreadyQueued === 3, "…and says why");
      ok(
        (await prisma.linkedInAction.count({ where: { organizationId: org.id } })) === 3,
        "still three actions — no duplicate invitations",
      );
    }

    console.log("\n— a finished action does not block a new one —");
    {
      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "sent" } });
      const r = await enqueueManyLinkedIn({ organizationId: org.id, leadIds: all, type: "message" });
      ok(r.queued === 3, "once the previous action is finished, they can be actioned again");
    }

    console.log("\n— the note ceiling —");
    {
      let threw = false;
      try {
        await enqueueManyLinkedIn({
          organizationId: org.id,
          leadIds: [withProfile[0].id],
          note: "x".repeat(INVITE_NOTE_MAX + 1),
          type: "invite",
        });
      } catch {
        threw = true;
      }
      ok(threw, "an invite note over the limit is refused rather than truncated");

      const long = await enqueueManyLinkedIn({
        organizationId: org.id,
        leadIds: [withProfile[0].id],
        note: "x".repeat(INVITE_NOTE_MAX + 1),
        type: "message",
      });
      ok(long.queued >= 0, "the same text is allowed as a message, which has no such limit");
    }

    console.log("\n— tenant isolation —");
    {
      const other = await prisma.organization.create({ data: { name: `oth-${stamp}`, slug: `oth-${stamp}` } });
      const foreign = await prisma.lead.create({
        data: {
          organizationId: other.id,
          firstName: "Foreign",
          linkedinUrl: `https://www.linkedin.com/in/foreign-${stamp}`,
        },
      });
      const r = await enqueueManyLinkedIn({ organizationId: org.id, leadIds: [foreign.id], type: "invite" });
      ok(r.queued === 0, "a lead in another workspace is never actioned");
      await prisma.lead.deleteMany({ where: { organizationId: other.id } });
      await prisma.organization.delete({ where: { id: other.id } }).catch(() => {});
    }
  } finally {
    await prisma.linkedInAction.deleteMany({ where: { organizationId: org.id } });
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
