/**
 * Put invited teammates back in the workspace they joined.
 *
 * Until lib/auth.ts#preferredOrganizationId, every new session opened in the
 * user's OLDEST membership — for anyone who signed up and then accepted an
 * invitation, that was the empty personal workspace created at sign-up. The fix
 * applies from their next sign-in; this repairs the sessions already open, so
 * tasks and notifications assigned to them show up now rather than whenever
 * they next log in.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-active-org.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-active-org.ts --yes
 *
 * Conservative on purpose:
 *   - only users with more than one workspace and no remembered choice yet;
 *   - a live session already on a non-oldest workspace is a deliberate switch,
 *     and that choice wins;
 *   - only sessions sitting on the oldest workspace (the buggy default) move.
 *
 * Idempotent: a user with lastActiveOrganizationId set is skipped, so re-running
 * costs nothing.
 */
import { prisma } from "../lib/db";

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--yes");

async function main() {
  if (!dryRun && !confirmed) {
    console.error("Refusing to write without --yes. Preview with --dry-run first.");
    process.exit(1);
  }

  const multi = await prisma.member.groupBy({
    by: ["userId"],
    _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
  });
  const userIds = multi.map((m) => m.userId);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, lastActiveOrganizationId: null },
        select: { id: true },
      })
    : [];
  console.log(`${users.length} user(s) in more than one workspace with no remembered workspace.`);

  const now = new Date();
  let usersChanged = 0;
  let sessionsMoved = 0;

  for (const { id: userId } of users) {
    const memberships = await prisma.member.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    const oldest = orgIds[0];
    const newest = orgIds[orgIds.length - 1];

    const live = await prisma.session.findMany({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, activeOrganizationId: true },
    });

    const deliberate = live.find(
      (s) => s.activeOrganizationId && s.activeOrganizationId !== oldest && orgIds.includes(s.activeOrganizationId),
    )?.activeOrganizationId;
    const target = deliberate ?? newest;

    const toMove = live.filter(
      (s) => s.activeOrganizationId !== target && (!s.activeOrganizationId || s.activeOrganizationId === oldest || !orgIds.includes(s.activeOrganizationId)),
    );

    usersChanged++;
    sessionsMoved += toMove.length;
    if (dryRun) continue;

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { lastActiveOrganizationId: target } }),
      ...(toMove.length
        ? [prisma.session.updateMany({ where: { id: { in: toMove.map((s) => s.id) } }, data: { activeOrganizationId: target } })]
        : []),
    ]);
  }

  console.log(
    `${dryRun ? "Would set" : "Set"} a workspace for ${usersChanged} user(s) and ${dryRun ? "move" : "moved"} ${sessionsMoved} open session(s).`,
  );
  if (dryRun) console.log("Dry run — nothing written.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
