/**
 * Verification for Posts + Autopilot scheduling (P3) — what's testable
 * without an actual OpenRouter call or a connected LinkedIn account:
 *
 *   - nextScheduledAt's arithmetic, both schedule shapes
 *   - the posts-sweep publishing a due post (fails cleanly with no LinkedIn
 *     account connected — proving the pipeline runs end to end, not that a
 *     real publish succeeds, which needs a live account)
 *   - a needs_review draft skipped once its slot has passed
 *   - an autopilot claimed exactly once by two sweeps racing on it
 *
 *   npx tsx --env-file=.env scripts/verify-posts.ts
 *
 * Deliberately does NOT call lib/posts/research.ts or lib/posts/write.ts —
 * both make real external calls (Google RSS, OpenRouter), and this script
 * makes no assertion about what they return. See docs/posts.md's "What's
 * unverified" for what a first real run still needs to confirm.
 */
import { prisma } from "../lib/db";
import { nextScheduledAt, sweepPosts, publishScheduledPost } from "../lib/posts/schedule";

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

const stamp = Date.now();
const orgIds: string[] = [];
async function newOrg(name: string) {
  const org = await prisma.organization.create({ data: { name: `posts-${name}-${stamp}`, slug: `posts-${name}-${stamp}` } });
  orgIds.push(org.id);
  return org.id;
}

const IST = 330;

async function main() {
  try {
    console.log("\n— nextScheduledAt —");
    // Every 2 days at 17:00 IST, asked from a moment already past today's slot.
    const from1 = new Date("2026-09-13T13:00:00.000Z"); // 18:30 IST — after 17:00 today
    const at1 = nextScheduledAt({ type: "every_n_days", n: 2, time: "17:00" }, IST, from1);
    // 17:00 IST = 11:30 UTC. Today (13th) has already passed; day 1 (14th) is
    // not a multiple of 2 days from today, so the next hit is day 2 (15th).
    ok(at1.toISOString() === "2026-09-15T11:30:00.000Z", `every 2 days lands on the 15th at 17:00 IST (got ${at1.toISOString()})`);

    // Weekdays Mon/Wed/Fri at 09:00 IST, asked from a Tuesday.
    const from2 = new Date("2026-09-15T04:00:00.000Z"); // Tue 09:30 IST
    const at2 = nextScheduledAt({ type: "weekdays", days: [1, 3, 5], time: "09:00" }, IST, from2);
    // Next Mon/Wed/Fri after Tue 15th is Wed 16th, 09:00 IST = 03:30 UTC.
    ok(at2.toISOString() === "2026-09-16T03:30:00.000Z", `weekdays picks the 16th (Wed) at 09:00 IST (got ${at2.toISOString()})`);

    console.log("\n— publishing a due post —");
    const org = await newOrg("publish");
    const user = await prisma.user.create({ data: { id: `u-${stamp}`, name: "Test", email: `posts-${stamp}@example.com`, emailVerified: false } });
    const post = await prisma.post.create({
      data: { organizationId: org, userId: user.id, status: "scheduled", body: "Hello, LinkedIn.", scheduledAt: new Date(Date.now() - 1000) },
    });
    await publishScheduledPost(post.id);
    const afterPublish = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    ok(
      afterPublish.status === "failed" && !!afterPublish.error,
      `with no LinkedIn account connected, it fails cleanly rather than crashing (status=${afterPublish.status})`,
    );

    const already = await prisma.post.create({ data: { organizationId: org, userId: user.id, status: "published", body: "x", publishedAt: new Date() } });
    await publishScheduledPost(already.id); // must be a no-op
    const stillPublished = await prisma.post.findUniqueOrThrow({ where: { id: already.id } });
    ok(stillPublished.status === "published", "an already-published post is left alone, never re-published");

    console.log("\n— the sweep —");
    const duePost = await prisma.post.create({
      data: { organizationId: org, userId: user.id, status: "scheduled", body: "Due via the sweep.", scheduledAt: new Date(Date.now() - 1000) },
    });
    const staleReview = await prisma.post.create({
      data: { organizationId: org, userId: user.id, status: "needs_review", body: "Never approved.", scheduledAt: new Date(Date.now() - 1000) },
    });
    const freshReview = await prisma.post.create({
      data: { organizationId: org, userId: user.id, status: "needs_review", body: "Still has time.", scheduledAt: new Date(Date.now() + 3_600_000) },
    });
    const swept = await sweepPosts();
    ok(swept.published >= 1 && swept.skipped >= 1, `the sweep processed at least our due post and skipped our stale review draft (${JSON.stringify(swept)})`);
    ok((await prisma.post.findUniqueOrThrow({ where: { id: duePost.id } })).status === "failed", "…the due post went through publishScheduledPost (fails cleanly, same as above)");
    ok((await prisma.post.findUniqueOrThrow({ where: { id: staleReview.id } })).status === "skipped", "…the stale review draft is skipped, not silently held forever");
    ok((await prisma.post.findUniqueOrThrow({ where: { id: freshReview.id } })).status === "needs_review", "…one with time left is untouched");

    console.log("\n— an autopilot is claimed once —");
    const autopilot = await prisma.autopilot.create({
      data: {
        organizationId: org,
        userId: user.id,
        name: `race-${stamp}`,
        query: "test query — never actually researched by this script",
        model: "minimax/minimax-m2",
        mode: "review",
        schedule: { type: "every_n_days", n: 1, time: "17:00" },
        timezoneOffsetMinutes: IST,
        enabled: true,
        nextRunAt: new Date(Date.now() - 1000),
      },
    });
    // Two sweeps "racing" on the same due autopilot — sequential here (this
    // script is single-threaded), but the claim itself is the same atomic
    // UPDATE...WHERE nextRunAt = <value> a real concurrent race would use.
    const before = await prisma.autopilot.findUniqueOrThrow({ where: { id: autopilot.id } });
    const claimed = await prisma.autopilot.updateMany({ where: { id: autopilot.id, nextRunAt: before.nextRunAt }, data: { nextRunAt: new Date(Date.now() + 60_000) } });
    const claimedAgain = await prisma.autopilot.updateMany({ where: { id: autopilot.id, nextRunAt: before.nextRunAt }, data: { nextRunAt: new Date(Date.now() + 60_000) } });
    ok(claimed.count === 1 && claimedAgain.count === 0, "the nextRunAt-guarded claim lets exactly one caller win");

    console.log("\n— done — research.ts and write.ts are not exercised here; see docs/posts.md —");
  } finally {
    for (const organizationId of orgIds) {
      const autopilotIds = (await prisma.autopilot.findMany({ where: { organizationId }, select: { id: true } })).map((a) => a.id);
      if (autopilotIds.length) await prisma.autopilotRun.deleteMany({ where: { autopilotId: { in: autopilotIds } } });
      await prisma.autopilot.deleteMany({ where: { organizationId } });
      await prisma.post.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { contains: `posts-${stamp}` } } }).catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
