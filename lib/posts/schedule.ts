/**
 * Scheduling for Posts and Autopilot: when an autopilot next fires, publishing
 * a scheduled post, and the sweep that catches both.
 *
 * `Autopilot.timezoneOffsetMinutes` is a fixed UTC offset rather than an IANA
 * zone — the same simplification lib/org-day.ts makes for business hours, and
 * for the same reason: "when is this next due" becomes arithmetic instead of
 * DST-aware calendar math a hand-rolled scheduler is the wrong place to get
 * subtly wrong.
 */
import { prisma } from "../db";
import { enqueueJob } from "../queue";
import { postToFeed } from "../linkedin/post";
import { requireModel, writePosts } from "./write";
import { findTrendingTopics } from "./research";
import type { Autopilot } from "@prisma/client";

const DAY_MS = 86_400_000;

type Schedule = { type: "every_n_days"; n: number; time: string } | { type: "weekdays"; days: number[]; time: string };

/** "HH:MM" -> minutes since local midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * The next moment (in real UTC) this autopilot's schedule is due, strictly
 * after `after`. Computed by walking the autopilot's own local calendar days
 * forward from `after` and testing each one against the schedule — simple
 * and correct for a fixed offset, at the cost of being O(days) rather than
 * closed-form; `days` here is never more than ~14 candidates.
 */
export function nextScheduledAt(schedule: Schedule, offsetMinutes: number, after: Date): Date {
  const localNow = new Date(after.getTime() + offsetMinutes * 60_000);
  const minuteOfDay = timeToMinutes(schedule.time);

  const candidateAt = (daysAhead: number) => {
    const local = new Date(localNow);
    local.setUTCHours(0, 0, 0, 0);
    local.setUTCDate(local.getUTCDate() + daysAhead);
    local.setUTCMinutes(minuteOfDay);
    return new Date(local.getTime() - offsetMinutes * 60_000);
  };

  for (let d = 0; d <= 400; d++) {
    const at = candidateAt(d);
    if (at <= after) continue;
    if (schedule.type === "every_n_days") {
      // Any day at/after "now" that lands on the right multiple of n from
      // today counts — the multiple resets from whenever this is first
      // computed, which is what "every N days" means without a fixed epoch.
      if (d % Math.max(1, schedule.n) === 0) return at;
    } else {
      const weekday = new Date(localNow.getTime() + d * DAY_MS).getUTCDay();
      if (schedule.days.includes(weekday)) return at;
    }
  }
  // Should be unreachable for a sane schedule; falls back to a day away rather than throwing.
  return new Date(after.getTime() + DAY_MS);
}

/** How far ahead of the actual slot a job should fire: the review lead time in review mode, ~15 min in auto mode. */
const leadMs = (a: Pick<Autopilot, "mode" | "reviewLeadHours">) => (a.mode === "review" ? a.reviewLeadHours * 3_600_000 : 15 * 60_000);

/**
 * One autopilot's turn: find topics, write a draft (or drafts), and either
 * hold it for review or schedule it to publish at the slot itself.
 */
async function runAutopilotOnce(autopilot: Autopilot) {
  const run = await prisma.autopilotRun.create({ data: { autopilotId: autopilot.id, status: "found_topics", topics: [] } });
  try {
    const topics = await findTrendingTopics(autopilot.query, autopilot.hashtags);
    await prisma.autopilotRun.update({ where: { id: run.id }, data: { topics: topics as object } });

    if (!topics.length) {
      await prisma.autopilotRun.update({ where: { id: run.id }, data: { status: "skipped_no_topics" } });
      return;
    }

    const model = requireModel(autopilot.model);
    // Auto-publish never writes more than the one that goes out — enforced
    // here as well as wherever the autopilot is saved, since a stored row
    // predating a UI validation change should not silently write extra.
    const variants = autopilot.mode === "auto" ? 1 : Math.max(1, Math.min(3, autopilot.variants));
    const { posts, failed } = await writePosts(
      {
        organizationId: autopilot.organizationId,
        userId: autopilot.userId,
        model,
        brief: autopilot.brief,
        topic: topics[0],
        variants,
        autopilotId: autopilot.id,
        runId: run.id,
      },
      autopilot.mode === "auto" ? "scheduled" : "needs_review",
    );

    if (!posts.length) {
      await prisma.autopilotRun.update({ where: { id: run.id }, data: { status: "failed", error: `${failed} draft(s) failed to write` } });
      return;
    }

    if (autopilot.mode === "auto") {
      // Written straight into "scheduled": the slot is now, and posts-sweep's
      // due-post pass (below) will publish it within the next few minutes.
      // This IS the slot firing, ~15 minutes early by design (leadMs), so the
      // post is scheduled for the ORIGINAL slot time, not "now".
      await prisma.post.update({
        where: { id: posts[0].postId },
        data: { scheduledAt: autopilot.nextRunAt ?? new Date() },
      });
      await enqueueJob({ kind: "post-publish", postId: posts[0].postId }, Math.max(0, (autopilot.nextRunAt?.getTime() ?? Date.now()) - Date.now()));
    }
    // review mode: left as needs_review with no scheduledAt. A person approves
    // it (or doesn't — see sweep below for what happens if they don't).

    await prisma.autopilotRun.update({ where: { id: run.id }, data: { status: autopilot.mode === "auto" ? "published" : "drafted" } });
  } catch (e) {
    console.error(`[posts/schedule] autopilot ${autopilot.id} run failed:`, e);
    await prisma.autopilotRun.update({ where: { id: run.id }, data: { status: "failed", error: e instanceof Error ? e.message : String(e) } });
  }
}

/** Actually publish one post. Marks it failed rather than throwing, so the sweep can move on to the next one. */
export async function publishScheduledPost(postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.status === "published") return; // already done, or gone — never double-publish
  if (post.platform !== "linkedin") return; // Instagram: coming soon, never scheduled

  await prisma.post.update({ where: { id: post.id }, data: { status: "publishing" } });
  const result = await postToFeed({
    organizationId: post.organizationId,
    userId: post.userId,
    text: post.body,
    imageUrl: post.mediaUrl,
    imageAlt: post.mediaAlt,
  });

  if (result.ok) {
    await prisma.post.update({ where: { id: post.id }, data: { status: "published", publishedAt: new Date(), externalUrn: result.urn } });
  } else {
    await prisma.post.update({ where: { id: post.id }, data: { status: "failed", error: result.error } });
  }
}

/**
 * The recurring sweep (/api/cron/posts-sweep): catches scheduled posts a
 * one-off job missed, starts autopilots whose turn has come, and skips a
 * review draft nobody approved before its slot passed. Safe to run as often
 * as it likes — every claim below is an atomic, status-guarded UPDATE.
 */
export async function sweepPosts(now = new Date()) {
  const duePosts = await prisma.post.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    select: { id: true },
    take: 100,
  });
  let published = 0;
  for (const p of duePosts) {
    await publishScheduledPost(p.id);
    published++;
  }

  // A review draft still unapproved once its slot has passed is skipped, not
  // silently held forever — the draft itself is kept, so nothing is lost,
  // only the window to post it on schedule.
  const skipped = await prisma.post.updateMany({
    where: { status: "needs_review", scheduledAt: { lte: now } },
    data: { status: "skipped" },
  });

  const dueAutopilots = await prisma.autopilot.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    take: 50,
  });
  let started = 0;
  for (const a of dueAutopilots) {
    // Claimed the same way an enrollment is: one atomic UPDATE, so two sweeps
    // running at once (a slow one overlapping the next tick) cannot both fire
    // the same autopilot.
    const { count } = await prisma.autopilot.updateMany({
      where: { id: a.id, nextRunAt: a.nextRunAt },
      data: { nextRunAt: new Date(now.getTime() + 5 * 60_000), lastRunAt: now }, // provisional, corrected below
    });
    if (!count) continue;
    started++;
    await runAutopilotOnce(a);
    const schedule = a.schedule as unknown as Schedule;
    const next = nextScheduledAt(schedule, a.timezoneOffsetMinutes, now.getTime() > (a.nextRunAt?.getTime() ?? 0) ? now : a.nextRunAt!);
    const fireAt = new Date(next.getTime() - leadMs(a));
    await prisma.autopilot.update({ where: { id: a.id }, data: { nextRunAt: fireAt } });
  }

  return { published, skipped: skipped.count, autopilotsStarted: started };
}

/** Called when an autopilot is created or its schedule changes, to give it its first nextRunAt. */
export function scheduleAutopilot(a: Pick<Autopilot, "schedule" | "timezoneOffsetMinutes" | "mode" | "reviewLeadHours">, from = new Date()) {
  const schedule = a.schedule as unknown as Schedule;
  const slot = nextScheduledAt(schedule, a.timezoneOffsetMinutes, from);
  return new Date(slot.getTime() - leadMs(a));
}
