/**
 * Verification for invitations with a note.
 *
 *   npx tsx --env-file=.env scripts/verify-linkedin-notes.ts
 *
 * Runs against whatever DATABASE_URL points at — which is production, there is
 * no other — inside a throwaway organization that it deletes afterwards.
 *
 * The rules it holds the queue to:
 *   - a note is a choice made per invitation, and rows queued before the choice
 *     existed keep their old meaning;
 *   - a free account hands out three notes a day, and an invitation that wants a
 *     fourth waits for tomorrow instead of going without, while invitations with
 *     no note keep flowing past it;
 *   - "Leads I pick" invitations never go out until somebody picks;
 *   - LinkedIn's own upsell closes the day's notes, whatever the setting says;
 *   - a desktop app too old to know about choices is never handed a note it was
 *     told not to send.
 */
import { prisma } from "../lib/db";
import {
  claimActions,
  FREE_NOTES_PER_DAY,
  noteLimitReached,
  peekActions,
  resolveNoteChoice,
  startOfOrgDay,
  updateQueuedInvitation,
} from "../lib/linkedin/queue";
import { linkedinChannel } from "../lib/channels/linkedin";
import { validateSequence } from "../lib/campaign-engine";

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
  const org = await prisma.organization.create({ data: { name: `li-notes-${stamp}`, slug: `li-notes-${stamp}` } });

  try {
    console.log("\n— what a row means —");
    ok(resolveNoteChoice({ noteChoice: null, note: "Hi" }) === "yes", "a row queued before the choice existed, with a note, still sends it");
    ok(resolveNoteChoice({ noteChoice: null, note: null }) === "no", "…and one without a note sends none");
    ok(resolveNoteChoice({ noteChoice: "undecided", note: "Hi" }) === "undecided", "an explicit choice wins over whether a note is there");

    console.log("\n— the day starts at the workspace's own midnight —");
    {
      const start = await startOfOrgDay(org.id, new Date("2026-09-12T20:00:00Z"));
      ok(
        start.toISOString() === "2026-09-12T18:30:00.000Z",
        `IST by default: 01:30 on the 13th belongs to the day that began at 18:30 UTC (got ${start.toISOString()})`,
      );
    }

    const leads = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        prisma.lead.create({
          data: { organizationId: org.id, firstName: `Note${i}`, linkedinUrl: `https://www.linkedin.com/in/notes-${stamp}-${i}` },
        }),
      ),
    );
    const arg = (i: number) => ({ id: leads[i].id, linkedinUrl: leads[i].linkedinUrl, firstName: leads[i].firstName });

    console.log('\n— a campaign step\'s "Add a note for" reaches the queue —');
    {
      const everyone = await linkedinChannel.send(arg(0), { body: "Hi from everyone" }, undefined, org.id, undefined, { linkedinAction: "invite", noteFor: "everyone" });
      const picked = await linkedinChannel.send(arg(1), { body: "Hi if picked" }, undefined, org.id, undefined, { linkedinAction: "invite", noteFor: "picked" });
      const none = await linkedinChannel.send(arg(2), { body: "Never a note" }, undefined, org.id, undefined, { linkedinAction: "invite", noteFor: "none" });
      const legacy = await linkedinChannel.send(arg(3), { body: "Old step" }, undefined, org.id, undefined, { linkedinAction: "invite" });
      const rows = await prisma.linkedInAction.findMany({
        where: { id: { in: [everyone, picked, none, legacy].map((r) => r.providerId!) } },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      ok(byId.get(everyone.providerId!)?.noteChoice === "yes", '"Everyone" queues the invitation with its note');
      ok(byId.get(picked.providerId!)?.noteChoice === "undecided", '"Leads I pick" queues it undecided');
      const noneRow = byId.get(none.providerId!);
      ok(noneRow?.noteChoice === "no" && noneRow?.note === null, '"No one" queues a plain request, with no note stored at all');
      ok(byId.get(legacy.providerId!)?.noteChoice === null, "a step saved before the choice existed leaves it unset");
    }
    await prisma.linkedInAction.deleteMany({ where: { organizationId: org.id } });

    console.log("\n— three notes a day on a free account —");
    let account = await prisma.linkedInAccount.create({
      data: { organizationId: org.id, userId: `u-${stamp}`, extToken: `tok-${stamp}`, autoSend: true },
    });
    ok(account.accountType === "free", "a new LinkedIn account starts as free");

    // Queue order is creation order, so it is set explicitly.
    const queue = (i: number, noteChoice: "yes" | "no" | "undecided", note: string | null) =>
      prisma.linkedInAction.create({
        data: {
          organizationId: org.id,
          leadId: leads[i].id,
          linkedinUrl: leads[i].linkedinUrl!,
          type: "invite",
          kind: "invite",
          note,
          noteChoice,
          status: "pending",
          createdAt: new Date(Date.now() - (10 - i) * 1000),
        },
      });
    const rows = [
      await queue(0, "yes", "Note zero"),
      await queue(1, "no", "A note nobody chose"),
      await queue(2, "yes", "Note two"),
      await queue(3, "yes", "Note three"),
      await queue(4, "undecided", "Pick me"),
      await queue(5, "yes", "Note five"),
      await queue(6, "no", null),
      await queue(7, "yes", "Note seven"),
    ];
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");

    let peek = await peekActions(account, 50);
    ok(peek.notes.cap === FREE_NOTES_PER_DAY && peek.notes.left === FREE_NOTES_PER_DAY, `a free account has ${FREE_NOTES_PER_DAY} notes and has used none`);
    ok(
      ids(peek.people) === ids([rows[0], rows[1], rows[2], rows[3], rows[6]]),
      "the first three invitations with a note go, and the two without flow past the rest",
    );
    ok(
      peek.held.some((h) => h.id === rows[5].id && h.hold === "no_notes_left") &&
        peek.held.some((h) => h.id === rows[7].id && h.hold === "no_notes_left"),
      "the fourth and fifth that want a note wait for tomorrow — they do not go without one",
    );
    ok(peek.held.some((h) => h.id === rows[4].id && h.hold === "needs_pick"), "the undecided one is listed as waiting for a pick");
    ok(!peek.people.some((p) => p.id === rows[4].id), "…and is not in the list that goes out");

    console.log("\n— what the desktop app is handed —");
    {
      const claimed = await claimActions(account, 10);
      const c = new Map(claimed.map((a) => [a.id, a]));
      ok(claimed.length === 5, `claims exactly the five that may go (got ${claimed.length})`);
      ok(c.get(rows[0].id)?.noteChoice === "yes" && c.get(rows[0].id)?.note === "Note zero", "an invitation with a note is handed its note");
      ok(
        c.get(rows[1].id)?.noteChoice === "no" && c.get(rows[1].id)?.note === null,
        'one marked "no" is handed no note at all, so an old desktop app cannot type it',
      );
      ok(!c.has(rows[4].id) && !c.has(rows[5].id), "nothing held is claimed");

      peek = await peekActions(account, 50);
      ok(peek.notes.left === 0, "three invitations in a browser with their notes use up the day");

      // Through the route too: it hand-picks the fields it returns, and a field
      // left off that list does nothing however right claimActions is.
      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id, status: "in_progress" }, data: { status: "pending" } });
      const { GET } = await import("../app/api/linkedin/queue/route");
      const { NextRequest } = await import("next/server");
      const res = await GET(
        new NextRequest("https://example.invalid/api/linkedin/queue?limit=10", {
          headers: { Authorization: `Bearer ${account.extToken}`, "x-followthroo-client": "desktop" },
        }),
      );
      const body = (await res.json()) as { data?: { actions?: { id: string; noteChoice?: string; note?: string | null }[] } };
      const served = body.data?.actions ?? [];
      ok(
        served.length > 0 && served.every((a) => a.noteChoice === "yes" || a.noteChoice === "no"),
        "the queue endpoint carries noteChoice over the wire, not just out of claimActions",
      );
      ok(served.find((a) => a.id === rows[1].id)?.note === null, '…and withholds the note of an invitation marked "no"');
    }

    console.log("\n— LinkedIn's upsell closes the day —");
    {
      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      account = await prisma.linkedInAccount.update({ where: { id: account.id }, data: { accountType: "premium" } });
      peek = await peekActions(account, 50);
      ok(
        peek.notes.cap === account.dailyInviteCap && !peek.held.some((h) => h.hold === "no_notes_left"),
        "a premium account can put a note on every invitation, up to its daily cap",
      );

      const [first] = await claimActions(account, 1);
      const requeued = await noteLimitReached(account.id, org.id, first.id, "upsell shown");
      account = (await prisma.linkedInAccount.findUnique({ where: { id: account.id } }))!;
      const back = await prisma.linkedInAction.findUnique({ where: { id: first.id } });
      ok(requeued && back?.status === "pending" && back?.note === first.note, "the invitation that met the upsell goes back to the queue with its note");
      peek = await peekActions(account, 50);
      ok(peek.notes.left === 0 && peek.notes.exhaustedByLinkedIn, "after the upsell no notes are left today, even on a premium setting");
      ok(!peek.people.some((p) => p.noteChoice === "yes"), "…so nothing with a note is next");
      ok(peek.people.some((p) => p.noteChoice === "no"), "…while plain invitations still are");
      ok((await prisma.activityLog.count({ where: { organizationId: org.id } })) === 0, "and nothing is written to the lead's activity — nothing happened to them");
    }

    console.log("\n— deciding a note from the LinkedIn screen or the Up next list —");
    {
      await prisma.linkedInAction.updateMany({ where: { organizationId: org.id }, data: { status: "pending" } });
      let r = await updateQueuedInvitation(org.id, rows[4].id, { noteChoice: "yes" });
      ok(r.ok && r.noteChoice === "yes", 'choosing "Add note" on an undecided invitation that has a template note makes it a yes');
      r = await updateQueuedInvitation(org.id, rows[6].id, { noteChoice: "yes" });
      ok(!r.ok && r.status === 400, "a note cannot be switched on when nothing is written");
      r = await updateQueuedInvitation(org.id, rows[6].id, { noteChoice: "yes", note: "  Written just now  " });
      ok(r.ok && r.note === "Written just now", "…but writing one and switching it on together works, trimmed");
      r = await updateQueuedInvitation(org.id, rows[2].id, { note: "x".repeat(301) });
      ok(!r.ok && r.status === 400, "a note longer than LinkedIn allows is refused");
      await prisma.linkedInAction.update({ where: { id: rows[3].id }, data: { status: "in_progress" } });
      r = await updateQueuedInvitation(org.id, rows[3].id, { noteChoice: "no" });
      ok(!r.ok && r.status === 409, "an invitation the desktop app already picked up cannot be changed");
      const other = await prisma.organization.create({ data: { name: `other-${stamp}`, slug: `other-${stamp}` } });
      r = await updateQueuedInvitation(other.id, rows[2].id, { noteChoice: "no" });
      ok(!r.ok && r.status === 404, "another workspace cannot touch this one's queue");
      await prisma.organization.delete({ where: { id: other.id } }).catch(() => {});
    }

    console.log("\n— the campaign-save guard —");
    {
      let v = await validateSequence(org.id, {
        nodes: [{ id: "n0", type: "send", channel: "linkedin", linkedinAction: "message", noteFor: "everyone", waitDays: 0 }],
      });
      ok(v.ok === false, "a note choice on a message step is refused");
      const longTpl = await prisma.template.create({
        data: { organizationId: org.id, name: `long-${stamp}`, channel: "linkedin", body: "x".repeat(320) },
      });
      v = await validateSequence(org.id, {
        nodes: [{ id: "n0", type: "send", channel: "linkedin", linkedinAction: "invite", noteFor: "none", templateId: longTpl.id, waitDays: 0 }],
      });
      ok(v.ok === true, 'a "No one" step is not held to the note length — its template is never a note');
      v = await validateSequence(org.id, {
        nodes: [{ id: "n0", type: "send", channel: "linkedin", linkedinAction: "invite", noteFor: "everyone", templateId: longTpl.id, waitDays: 0 }],
      });
      ok(v.ok === false, '…while an "Everyone" step still is');
    }
  } finally {
    await prisma.linkedInAction.deleteMany({ where: { organizationId: org.id } });
    await prisma.linkedInAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.message.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.template.deleteMany({ where: { organizationId: org.id } });
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
