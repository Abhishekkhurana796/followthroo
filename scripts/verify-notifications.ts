/**
 * Verification for assignment notifications (Phase B).
 *
 * The behaviour that matters is as much about what does NOT fire as what does:
 * a bell that buzzes for things you did yourself is one people learn to ignore,
 * which costs you the notifications that mattered.
 *
 *   npx tsx --env-file=.env scripts/verify-notifications.ts
 *
 * SMTP is cleared below before the application is dynamically imported, so this never puts
 * real mail on the wire: the recipients here are @t.local throwaways, and
 * bouncing three of those off the production Zoho account on every run is not
 * a test, it is backscatter. What gets asserted instead is every branch the
 * dispatcher takes *before* the transport — which is where the logic lives.
 */
process.env.SYSTEM_EMAIL_DRY_RUN = "1";
for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) delete process.env[key];

let dbClient: (typeof import("../lib/db"))["prisma"] | undefined;

let pass = 0;
let fail = 0;
let orgId: string | null = null;
const fixtureUserIds: string[] = [];
const ok = (c: boolean, m: string, extra = "") => {
  if (c) {
    pass++;
    console.log("  ok  ", m, extra);
  } else {
    fail++;
    console.log("  FAIL", m, extra);
  }
};

async function cleanup() {
  const prisma = dbClient;
  if (!orgId || !prisma) return;

  // The production-only database can briefly drop its pooled connection. Each
  // operation is idempotent, so retrying the complete cleanup is safe even when
  // an earlier attempt got halfway through.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.notification.deleteMany({ where: { organizationId: orgId } });
      await prisma.task.deleteMany({ where: { organizationId: orgId } });
      await prisma.lead.deleteMany({ where: { organizationId: orgId } });
      await prisma.member.deleteMany({ where: { organizationId: orgId } });
      if (fixtureUserIds.length) await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

async function main(): Promise<number> {
  // Static imports are hoisted: clearing process.env above a static application
  // import is not an ordering guarantee. Dynamic imports are, and lib/env now
  // sees SMTP as absent when it builds its cached configuration.
  const { prisma } = await import("../lib/db");
  dbClient = prisma;
  const { notify, listNotifications, markRead, notifyLeadAssigned } = await import("../lib/notifications");
  const { createTask, updateTask, notifyTaskAssigned } = await import("../lib/tasks");
  const { readPrefs } = await import("../lib/task-reminders");

  // Defaults on for someone who has never opened the settings.
  const d = readPrefs(null);
  ok(d.taskAssigned && d.leadAssigned, "new preferences default to on");
  ok(readPrefs({ taskAssigned: false }).taskAssigned === false, "an explicit false is respected");
  ok(readPrefs({ taskAssigned: false }).dailyDigest === true, "and does not disturb the others");

  const stamp = Date.now();
  const org = await prisma.organization.create({ data: { name: "notif-test", slug: `notif-test-${stamp}` } });
  const createdOrgId = org.id;
  orgId = createdOrgId;

  const mk = async (handle: string) => {
    const u = await prisma.user.create({
      data: { name: handle, email: `${handle}-${stamp}@t.local`, emailVerified: true },
    });
    fixtureUserIds.push(u.id);
    await prisma.member.create({ data: { organizationId: createdOrgId, userId: u.id, role: "member" } });
    return u.id;
  };
  const manager = await mk("mgr");
  const rep = await mk("rep");
  const other = await mk("other");

  const countFor = async (userId: string) => (await listNotifications(createdOrgId, userId)).unread;

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

  // ---- the email half ------------------------------------------------------
  // Every one of these used to be indistinguishable from the outside: the
  // result of the send was discarded and nothing was logged, so "no email
  // arrived" could equally have been the preference, the address, the actor
  // check, or SMTP. Each branch now reports itself.
  const emailTask = { id: "t1", organizationId: orgId, title: "Ring the client", dueAt: null, leadId: null };

  // Dedicated recipients: these assertions raise real notifications, and the
  // lead-assignment checks further down count rep's unread.
  const mailee = await mk("mailee");
  const muteds = await mk("muted");
  const toOther = await notifyTaskAssigned({ ...emailTask, ownerId: mailee }, manager);
  ok(toOther?.notified === true, "assigning to someone else raises the notification");
  ok(toOther?.emailRequested === true, "...and asks for an email");
  ok(toOther?.preferenceAllowed === true, "...which their preferences allow by default");
  ok(toOther?.emailAttempted === true, "...so the email is handed to the transport", `email=${toOther?.recipientEmail}`);
  ok(toOther?.recipientEmail?.startsWith("mailee-") === true, "...addressed to the assignee, not the assigner");

  const toSelf = await notifyTaskAssigned({ ...emailTask, ownerId: manager }, manager);
  ok(toSelf?.notified === false, "assigning to yourself raises nothing");
  ok(toSelf?.skipped === "self_action", "...and says why", `skipped=${toSelf?.skipped}`);
  ok(toSelf?.emailAttempted === false, "...and sends no email");

  // Preference off: the bell still rings, the email does not.
  await prisma.user.update({ where: { id: muteds }, data: { notificationPrefs: { taskAssigned: false } } });
  const muted = await notifyTaskAssigned({ ...emailTask, ownerId: muteds }, manager);
  ok(muted?.notified === true, "a muted recipient still gets the in-app notification");
  ok(muted?.preferenceAllowed === false, "...but the preference blocks the email");
  ok(muted?.emailAttempted === false, "...so nothing is handed to the transport");

  // A recipient the user table cannot resolve — a stale ownerId, which is
  // possible because Task.ownerId and Notification.userId are raw ids with no
  // foreign key. The bell row is still written; there is simply nobody to mail.
  // (Blanking a real user's email would be the more literal test, but User.email
  // is unique, so `""` can only ever exist once in the whole database.)
  const noAddress = await notifyTaskAssigned({ ...emailTask, ownerId: `missing-${stamp}` }, manager);
  ok(noAddress?.notified === true, "an unresolvable recipient still gets the bell");
  ok(noAddress?.recipientEmail === null, "...with no address found", `email=${String(noAddress?.recipientEmail)}`);
  ok(noAddress?.emailAttempted === false, "...and no email is attempted");

  // SMTP unreachable/unconfigured must not take the task with it.
  const survived = await createTask({ organizationId: orgId, title: "Survives a dead mailer", ownerId: mailee, createdBy: manager });
  ok(!!survived?.id, "a task is still created when the email cannot be sent");
  const lastAttempt = await notifyTaskAssigned({ ...emailTask, ownerId: mailee }, manager);
  ok(lastAttempt?.emailSent === false, "...the send reports failure rather than throwing");
  ok(lastAttempt?.emailError === "dry_run", "...naming the reason", `reason=${lastAttempt?.emailError}`);

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
  ok(batched.notified, "a batch produces one notification, not forty");
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

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

void (async () => {
  let exitCode = 1;
  try {
    exitCode = await main();
  } catch (e) {
    console.error(e);
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error("[verify-notifications] fixture cleanup failed:", e);
      exitCode = 1;
    }
    await dbClient?.$disconnect();
    process.exitCode = exitCode;
  }
})();
