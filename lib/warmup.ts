/**
 * Mailbox warm-up engine.
 *
 * Enabled mailboxes in an org send small, human-looking emails to each other on a ramping
 * daily schedule. The reply poller recognizes these (sender is one of the org's own
 * mailboxes), records a WarmupEvent(received) with placement, and rescues any that landed
 * in spam. Deliverability score is derived from inbox-vs-spam placement (see lib/deliverability.ts).
 *
 * Warm-up sends bypass the campaign rate limiter and suppression (they're internal), and
 * are NOT tracked (no pixels) — they call the email channel directly.
 */
import { prisma } from "./db";
import { emailChannel } from "./channels/email";
import type { Lead } from "./channels/types";

const SUBJECTS = ["Quick note", "Following up", "Checking in", "Re: our chat", "Thanks again", "Quick question", "Touching base"];
const BODIES = [
  "<p>Hey — just making sure this thread is still active on your end. Appreciate it!</p>",
  "<p>Thanks for the note earlier, this was really helpful. Talk soon.</p>",
  "<p>Circling back on this — let me know if you need anything from me.</p>",
  "<p>Great chatting today. I'll follow up with the details shortly.</p>",
  "<p>Confirming receipt — all looks good on my side. Cheers!</p>",
];
const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Ramp from 2/day up to dailyTarget over rampDays. */
function targetForToday(w: { dailyTarget: number; rampDays: number; createdAt: Date }): number {
  const daysIn = Math.floor((Date.now() - w.createdAt.getTime()) / 86_400_000);
  const start = 2;
  if (w.rampDays <= 0) return w.dailyTarget;
  const t = Math.round(start + (w.dailyTarget - start) * Math.min(daysIn / w.rampDays, 1));
  return Math.max(1, Math.min(t, w.dailyTarget));
}

export interface WarmupRunResult {
  mailboxes: number;
  sent: number;
  skipped?: string;
}

export async function runWarmupForOrg(orgId: string): Promise<WarmupRunResult> {
  const warmups = await prisma.warmup.findMany({
    where: { organizationId: orgId, enabled: true },
    // Only the two fields this function reads. A SendingAccount row also carries
    // pass / refreshToken / dkimPrivateKey, and nothing server-side needs them here.
    include: { sendingAccount: { select: { email: true, active: true } } },
  });
  const active = warmups.filter((w) => w.sendingAccount.active);
  if (active.length < 2) return { mailboxes: active.length, sent: 0, skipped: "need ≥2 enabled warm-up mailboxes" };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let sent = 0;

  for (const w of active) {
    const sentToday = await prisma.warmupEvent.count({
      where: { sendingAccountId: w.sendingAccountId, direction: "sent", at: { gte: startOfDay } },
    });
    const remaining = Math.max(0, targetForToday(w) - sentToday);
    const recipients = active.filter((r) => r.sendingAccountId !== w.sendingAccountId);

    for (let i = 0; i < remaining; i++) {
      const recip = recipients[(sentToday + i) % recipients.length];
      const to: Lead = { id: "warmup", email: recip.sendingAccount.email, phone: null, linkedinUrl: null, firstName: null };
      const res = await emailChannel.send(to, { subject: rand(SUBJECTS), body: rand(BODIES) }, w.sendingAccountId, orgId);
      await prisma.warmupEvent.create({
        data: { organizationId: orgId, sendingAccountId: w.sendingAccountId, direction: "sent", providerMessageId: res.providerId },
      });
      if (res.ok) sent++;
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 400)); // gentle jitter
    }
  }
  return { mailboxes: active.length, sent };
}

export async function runAllWarmups(): Promise<Record<string, WarmupRunResult>> {
  const orgs = await prisma.warmup.findMany({
    where: { enabled: true, organizationId: { not: null } },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  const out: Record<string, WarmupRunResult> = {};
  for (const { organizationId } of orgs) {
    if (organizationId) out[organizationId] = await runWarmupForOrg(organizationId);
  }
  return out;
}
