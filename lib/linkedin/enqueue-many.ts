/**
 * Queue LinkedIn actions for a set of leads.
 *
 * Two callers need this and they authenticate differently: the extension hits
 * `/api/linkedin/run` with its bearer token, and the app hits
 * `/api/linkedin/invite` with a session. The rules about *which* contacts can be
 * actioned are the same in both cases, so they live here rather than in two
 * routes that would drift.
 */
import { prisma } from "../db";
import { enqueueLinkedInAction } from "./queue";
import { INVITE_NOTE_MAX } from "./note";

export interface EnqueueManyResult {
  /** Actions actually created. */
  queued: number;
  /** Selected, but with no LinkedIn profile to act on. */
  noProfile: number;
  /** Selected, but already had a pending or in-flight action. */
  alreadyQueued: number;
}

/**
 * What would happen, without doing it.
 *
 * The dialog needs to say "19 of your 24 have a LinkedIn profile" *before* the
 * person commits, not report it as a skip count afterwards. With most leads
 * arriving from CSV and email, "nothing happened" is otherwise the common case
 * and it reads as a bug.
 */
export async function previewEnqueue(organizationId: string, leadIds: string[]) {
  const [withProfile, alreadyQueued] = await Promise.all([
    prisma.lead.count({
      where: { id: { in: leadIds }, organizationId, linkedinUrl: { not: null } },
    }),
    prisma.linkedInAction.count({
      where: {
        organizationId,
        leadId: { in: leadIds },
        status: { in: ["pending", "in_progress", "drafted"] },
      },
    }),
  ]);
  return {
    selected: leadIds.length,
    withProfile,
    noProfile: leadIds.length - withProfile,
    alreadyQueued,
  };
}

export async function enqueueManyLinkedIn(input: {
  organizationId: string;
  leadIds: string[];
  note?: string | null;
  type?: "auto" | "invite" | "message";
  campaignId?: string | null;
}): Promise<EnqueueManyResult> {
  const { organizationId, leadIds } = input;
  const type = input.type ?? "invite";
  const note = input.note?.trim() || null;

  if (type === "invite" && note && note.length > INVITE_NOTE_MAX) {
    throw new Error(`A connection note cannot be longer than ${INVITE_NOTE_MAX} characters.`);
  }

  // Only contacts with a profile can be actioned at all.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, organizationId, linkedinUrl: { not: null } },
    select: { id: true, linkedinUrl: true },
  });

  // Queueing the same person twice sends them two invitations, which is worse
  // than doing nothing — so anything already in flight is skipped rather than
  // duplicated. Cheap to check, and impossible to undo once sent.
  const inFlight = await prisma.linkedInAction.findMany({
    where: {
      organizationId,
      leadId: { in: leads.map((l) => l.id) },
      status: { in: ["pending", "in_progress", "drafted"] },
    },
    select: { leadId: true },
  });
  const busy = new Set(inFlight.map((a) => a.leadId));

  let queued = 0;
  for (const lead of leads) {
    if (busy.has(lead.id)) continue;
    await enqueueLinkedInAction({
      organizationId,
      leadId: lead.id,
      linkedinUrl: lead.linkedinUrl!,
      note,
      type,
      campaignId: input.campaignId ?? null,
    });
    queued++;
  }

  return {
    queued,
    noProfile: leadIds.length - leads.length,
    alreadyQueued: leads.length - queued,
  };
}
