/**
 * Verification for assignment notifications (Phase B).
 *
 * The behaviour that matters is as much about what does NOT fire as what does:
 * a bell that buzzes for things you did yourself is one people learn to ignore,
 * which costs you the notifications that mattered.
 *
 *   npx tsx --env-file=.env.local scripts/verify-notifications.ts
 */
import { prisma } from "../lib/db";
import { notify, listNotifications, markRead, notifyLeadAssigned } from "../lib/notifications";
import { createTask, updateTask } from "../lib/tasks";
import { readPrefs } from "../lib/task-reminders";

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
  // Defaults on for someone who has never opened the settings.
  const d = readPrefs(null);
  ok(d.taskAssigned && d.leadAssigned, "new preferences default to on");
  ok(readPrefs({ taskAssigned: false }).taskAssigned === false, "an explicit false is respected");
  ok(readPrefs({ taskAssigned: false }).dailyDigest === true, "and does not disturb the others");

  const stamp = Date.now();
  const org = await prisma.organization.create({ data: { name: "notif-test", slug: `notif-test-${stamp}` } });
  const orgId = org.id;

  const mk = async (handle: string) => {
    const u = await prisma.user.create({
      data: { name: handle, email: `${handle}-${stamp}@t.local`, emailVerified: true },
    });
    await prisma.member.create({ data: { organizationId: orgId, userId: u.id, role: "member" } });
    return u.id;
  };
  const manager = await mk("mgr");
  const rep = await mk("rep");
  const other = await mk("other");

  const countFor = async (userId: string) => (await listNotifications(orgId, userId)).unread;

  // ---- task assignment ----------------------------------------------------
  await createTask({ organizationId: orgId, title: "Call the client", ownerId: rep, createdBy: manager });
  ok((await countFor(rep)) === 1, "assigning a task notifies the owner", `unread=${await countFor(rep)}`);
  ok((await countFor(manager)) === 0, "and not the person who assigned it");

  await createTask({ organizationId: orgId, title: "My own note", ownerId: manager, createdBy: manager });
  ok((await countFor(manager)) === 0, "self-assignment notifies nobody");

  const unowned = await createTask({ organizationId: orgId, title: "Nobody's task", createdBy: manager });
  ok((await countFor(rep)) === 1, "a task with no owner notifies nobody", `unread=${await countFor(rep)}`);

  // ---- reassignment -------------------------------------------------------
  const before = await countFor(rep);
  await updateTask(orgId, unowned.id, { ownerId: other }, manager);
  ok((await countFor(other)) === 1, "reassignment notifies the new owner");
  ok((await countFor(rep)) === before, "and leaves the previous owner's count alone");

  // Editing without touching ownership must stay silent.
  const otherBefore = await countFor(other);
  await updateTask(orgId, unowned.id, { title: "Renamed" }, manager);
  ok((await countFor(other)) === otherBefore, "editing a task without reassigning notifies nobody");

  // Re-saving the SAME owner is not a reassignment.
  await updateTask(orgId, unowned.id, { ownerId: other }, manager);
  ok((await countFor(other)) === otherBefore, "re-saving the same owner does not re-notify");

  // ---- lead assignment ----------------------------------------------------
  const lead = await prisma.lead.create({
    data: { organizationId: orgId, firstName: "Rahul", email: `rahul-${stamp}@lead.local` },
  });
  await notifyLeadAssigned({ organizationId: orgId, userId: rep, actorId: manager, leadId: lead.id, leadName: "Rahul" });
  ok((await countFor(rep)) === before + 1, "assigning a contact notifies its new owner");

  const batched = await notifyLeadAssigned({
    organizationId: orgId,
    userId: rep,
    actorId: manager,
    leadId: lead.id,
    leadName: "Rahul",
    count: 40,
  });
  ok(batched, "a batch produces one notification, not forty");
  const repItems = (await listNotifications(orgId, rep)).items;
  ok(!!repItems.find((i) => i.title.includes("40 contacts")), "and says how many", repItems[0]?.title);

  // ---- read state ---------------------------------------------------------
  const beforeRead = await countFor(rep);
  ok(beforeRead > 0, "there is something unread to clear", `unread=${beforeRead}`);
  const marked = await markRead(orgId, rep, [repItems[0].id]);
  ok(marked === 1, "marking one works");
  ok((await countFor(rep)) === beforeRead - 1, "the count drops by exactly one");
  await markRead(orgId, rep);
  ok((await countFor(rep)) === 0, "marking all clears it");

  // ---- isolation ----------------------------------------------------------
  await notify({ organizationId: orgId, userId: other, kind: "task_assigned", title: "Private" });
  const otherItems = (await listNotifications(orgId, other)).items;
  const repItems2 = (await listNotifications(orgId, rep)).items;
  ok(!!otherItems.find((i) => i.title === "Private"), "a notification reaches its recipient");
  ok(!repItems2.find((i) => i.title === "Private"), "and nobody else");

  const stolen = await markRead(orgId, rep, [otherItems[0].id]);
  ok(stolen === 0, "you cannot mark someone else's notification read", `marked=${stolen}`);

  // cleanup
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.task.deleteMany({ where: { organizationId: orgId } });
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [manager, rep, other] } } });
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
