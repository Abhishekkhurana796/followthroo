/**
 * Verification for strict visibility + auto-assignment (Phase A).
 *
 * The two are one feature: removing the shared pool makes an unassigned contact
 * invisible to every rep, so assignment has to actually land — and when it does
 * not, the contact has to show up somewhere a human looks. Both halves are
 * asserted here, plus the leak this closed on the tasks side.
 *
 *   npx tsx --env-file=.env.local scripts/verify-assignment.ts
 */
import { prisma } from "../lib/db";
import { leadScope, taskOwnerScope, unassignedScope, canSeeUnassigned } from "../lib/scope";
import { resolveLeadOwner } from "../lib/assignment";
import { listTasks } from "../lib/tasks";
import { getHome } from "../lib/queries";
import type { TenantContext } from "../lib/tenant";

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
  const stamp = Date.now();
  const org = await prisma.organization.create({ data: { name: "assign-test", slug: `assign-test-${stamp}` } });
  const orgId = org.id;

  const mk = async (handle: string, role: string, dept: "sales" | "support" | null) => {
    const u = await prisma.user.create({
      data: { name: handle, email: `${handle}-${stamp}@t.local`, emailVerified: true },
    });
    await prisma.member.create({
      data: { organizationId: orgId, userId: u.id, role, ...(dept ? { department: dept } : {}) },
    });
    return u.id;
  };
  const owner = await mk("owner", "owner", null);
  const mgr = await mk("mgr", "group_leader", "sales");
  const repA = await mk("repa", "member", "sales");
  const repB = await mk("repb", "member", "sales");
  const repC = await mk("repc", "member", "support");

  const ctx = (userId: string, role: string, department: string | null): TenantContext => ({
    userId,
    orgId,
    role,
    department,
  });

  const mkLead = (name: string, ownerId: string | null, createdById: string | null = null) =>
    prisma.lead.create({
      data: { organizationId: orgId, firstName: name, email: `${name}-${stamp}@lead.local`, ownerId, createdById },
    });

  await mkLead("ownedByA", repA);
  await mkLead("ownedByB", repB);
  await mkLead("nobody", null);

  const seen = async (c: TenantContext) => {
    const s = await leadScope(c);
    return (await prisma.lead.findMany({ where: s.where, select: { firstName: true } })).map((r) => r.firstName!).sort();
  };

  // ---- strict visibility ---------------------------------------------------
  const aSees = await seen(ctx(repA, "member", "sales"));
  ok(aSees.join(",") === "ownedByA", "a rep sees only their own contacts", aSees.join(",") || "(none)");
  ok(!aSees.includes("nobody"), "the unassigned pool is gone — a rep cannot browse it");
  ok(!aSees.includes("ownedByB"), "a rep cannot see a peer's contact");

  const mgrSees = await seen(ctx(mgr, "group_leader", "sales"));
  ok(mgrSees.includes("ownedByA") && mgrSees.includes("ownedByB"), "a manager sees their department", mgrSees.join(","));
  ok(!mgrSees.includes("nobody"), "a manager's scope also excludes unassigned");

  const ownerSees = await seen(ctx(owner, "owner", null));
  ok(ownerSees.length === 3, "the owner still sees everything", ownerSees.join(","));

  // ---- unassigned is a place, not a gap ------------------------------------
  ok(unassignedScope(ctx(repA, "member", "sales")) === null, "a rep cannot open the Unassigned view");
  ok(!!unassignedScope(ctx(mgr, "group_leader", "sales")), "a manager can");
  ok(canSeeUnassigned("owner") && canSeeUnassigned("admin"), "so can owner and admin");

  const unassignedCount = await prisma.lead.count({ where: unassignedScope(ctx(owner, "owner", null))! });
  ok(unassignedCount === 1, "the Unassigned view finds the orphan", `count=${unassignedCount}`);

  const ownerHome = await getHome(orgId, await leadScope(ctx(owner, "owner", null)), unassignedScope(ctx(owner, "owner", null)));
  ok(ownerHome.counts.unassigned === 1, "Home surfaces it to the owner", `count=${ownerHome.counts.unassigned}`);
  const repHome = await getHome(orgId, await leadScope(ctx(repA, "member", "sales")), unassignedScope(ctx(repA, "member", "sales")));
  ok(repHome.counts.unassigned === 0, "and not to a rep");

  // ---- tasks were never scoped at all --------------------------------------
  await prisma.task.create({ data: { organizationId: orgId, title: "A's task", ownerId: repA } });
  await prisma.task.create({ data: { organizationId: orgId, title: "B's task", ownerId: repB } });
  await prisma.task.create({ data: { organizationId: orgId, title: "C's task", ownerId: repC } });

  const aTasks = await listTasks(orgId, { ownerIds: await taskOwnerScope(ctx(repA, "member", "sales")) });
  ok(aTasks.length === 1 && aTasks[0].title === "A's task", "a rep sees only their own tasks", `${aTasks.length} task(s)`);

  const mgrTasks = await listTasks(orgId, { ownerIds: await taskOwnerScope(ctx(mgr, "group_leader", "sales")) });
  const mgrTitles = mgrTasks.map((t) => t.title).sort();
  ok(mgrTitles.length === 2, "a manager sees their department's tasks", mgrTitles.join(","));
  ok(!mgrTitles.includes("C's task"), "and not another department's");

  const ownerTasks = await listTasks(orgId, { ownerIds: await taskOwnerScope(ctx(owner, "owner", null)) });
  ok(ownerTasks.length === 3, "the owner still sees every task", `${ownerTasks.length}`);

  // ---- assignment rules ----------------------------------------------------
  const src = await prisma.leadSource.create({
    data: { organizationId: orgId, key: `test_src_${stamp}`, label: "Test source" },
  });
  const key = src.key;

  // manual → the actor owns what they added
  ok((await resolveLeadOwner(orgId, { sourceKey: key, actorId: repA })) === repA, "manual falls back to whoever added it");

  // fixed
  await prisma.leadSource.update({ where: { id: src.id }, data: { assignmentRule: "fixed", assignedToId: repB } });
  ok((await resolveLeadOwner(orgId, { sourceKey: key })) === repB, "fixed routes to the named person");

  await prisma.leadSource.update({ where: { id: src.id }, data: { assignedToId: "user-who-left" } });
  ok(
    (await resolveLeadOwner(orgId, { sourceKey: key, actorId: repA })) === repA,
    "fixed pointing at someone who left falls back rather than assigning to a ghost"
  );

  // round-robin, scoped to sales (repA, repB, mgr) — must advance and wrap
  await prisma.leadSource.update({
    where: { id: src.id },
    data: { assignmentRule: "round_robin", assignedToId: null, assignmentDept: "sales", lastAssignedUserId: null },
  });
  const rotation: string[] = [];
  for (let i = 0; i < 6; i++) rotation.push((await resolveLeadOwner(orgId, { sourceKey: key }))!);
  const salesPool = new Set([mgr, repA, repB]);
  ok(rotation.every((u) => salesPool.has(u)), "round-robin stays inside the department");
  ok(!rotation.includes(repC), "and never reaches another department");
  ok(new Set(rotation).size === 3, "it uses everyone in the pool", `${new Set(rotation).size} distinct`);
  ok(rotation[0] === rotation[3] && rotation[1] === rotation[4], "the cursor wraps cleanly", rotation.join(" → "));

  // workload — the emptiest book wins. repC is in support and has no contacts.
  await prisma.leadSource.update({
    where: { id: src.id },
    data: { assignmentRule: "workload", assignmentDept: "support" },
  });
  ok((await resolveLeadOwner(orgId, { sourceKey: key })) === repC, "workload picks the lightest load");

  // an empty pool must not throw or lose the lead
  await prisma.leadSource.update({ where: { id: src.id }, data: { assignmentRule: "round_robin", assignmentDept: "collections" } });
  ok(
    (await resolveLeadOwner(orgId, { sourceKey: key, actorId: null })) === null,
    "an empty department leaves the contact unassigned instead of throwing"
  );

  ok((await resolveLeadOwner(orgId, { sourceKey: "no_such_source", actorId: repA })) === repA, "an unknown source falls back to the actor");

  // cleanup
  await prisma.task.deleteMany({ where: { organizationId: orgId } });
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.leadSource.deleteMany({ where: { organizationId: orgId } });
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, mgr, repA, repB, repC] } } });
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
