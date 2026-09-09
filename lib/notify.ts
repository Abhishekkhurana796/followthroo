/**
 * Auto-notification on capture (product PRD §5): a business-hours-aware acknowledgment
 * to the contact, and an immediate alert to whoever the lead was assigned to. "Instant
 * response" for the contact doesn't mean a WhatsApp at 11pm — the staff alert isn't
 * gated the same way, since a rep should know about a new lead right away regardless.
 */
import { prisma } from "./db";
import { defaultSendingAccountId } from "./channels/email";
import { renderMessage } from "./templates";
import { safeSend } from "./channels";
import { sendSystemEmail } from "./channels/email";
import { enqueueJob } from "./queue";

export type BusinessHours = { startHour: number; endHour: number; timezoneOffsetMinutes: number; days: number[] };

// 9am–7pm IST (UTC+5:30), Monday–Saturday — a sane default so this works with zero setup.
const DEFAULT_BUSINESS_HOURS: BusinessHours = { startHour: 9, endHour: 19, timezoneOffsetMinutes: 330, days: [1, 2, 3, 4, 5, 6] };

export function getBusinessHours(raw: unknown): BusinessHours {
  if (raw && typeof raw === "object") return { ...DEFAULT_BUSINESS_HOURS, ...(raw as Partial<BusinessHours>) };
  return DEFAULT_BUSINESS_HOURS;
}

/** Minutes from `now` until business hours are open; 0 if already open. */
function minutesUntilOpen(hours: BusinessHours, now = new Date()): number {
  const localNow = new Date(now.getTime() + hours.timezoneOffsetMinutes * 60_000);
  for (let add = 0; add <= 7; add++) {
    const candidate = new Date(localNow);
    candidate.setUTCDate(candidate.getUTCDate() + add);
    if (!hours.days.includes(candidate.getUTCDay())) continue;

    const openAt = new Date(candidate);
    openAt.setUTCHours(hours.startHour, 0, 0, 0);
    const closeAt = new Date(candidate);
    closeAt.setUTCHours(hours.endHour, 0, 0, 0);

    if (add === 0) {
      if (localNow >= openAt && localNow < closeAt) return 0;
      if (localNow < openAt) return Math.ceil((openAt.getTime() - localNow.getTime()) / 60_000);
      continue; // past closing today — check the next eligible day
    }
    return Math.ceil((openAt.getTime() - localNow.getTime()) / 60_000);
  }
  return 0; // no eligible day found in a week — fail open rather than never send
}

const ACK_TEMPLATE = {
  subject: "We've got your enquiry",
  body: "Hi {{firstName|there}},\n\nThanks for reaching out — a member of our team will be in touch shortly.",
};

/** Sends the fixed capture-acknowledgment to one lead. Re-fetches the lead so a delayed
 *  send (queued outside business hours) reflects whatever's true by the time it fires. */
export async function sendCaptureAck(organizationId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) return;

  const channel = lead.email ? "email" : lead.phone ? "whatsapp" : null;
  if (!channel) return;

  const rendered = renderMessage(ACK_TEMPLATE, lead);
  // Email needs a mailbox the workspace actually connected — there is no platform
  // fallback sender any more. WhatsApp still resolves its number at the adapter.
  const accountId = channel === "email" ? await defaultSendingAccountId(organizationId) : null;
  if (channel === "email" && !accountId) return;
  await safeSend(
    channel,
    { id: lead.id, email: lead.email, phone: lead.phone, linkedinUrl: lead.linkedinUrl, firstName: lead.firstName },
    rendered,
    accountId ?? undefined,
    organizationId,
  );
}

/** Alerts the assigned rep by email. Sent directly (not through safeSend/ConversationEvent
 *  — this is an internal notification about a lead, not a message to one). */
async function alertAssignedRep(organizationId: string, ownerId: string, lead: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; company: string | null }) {
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true, name: true } });
  if (!owner?.email) return;

  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email || lead.phone || "A new contact";
  // Internal mail to our own user, so it goes through the platform mailbox rather than
  // burning a customer's sending reputation on a notification they never sent.
  await sendSystemEmail(
    owner.email,
    `New lead: ${name}`,
    `${name} was just captured and assigned to you.\n\nCompany: ${lead.company ?? "—"}\nEmail: ${lead.email ?? "—"}\nPhone: ${lead.phone ?? "—"}`,
  );
}

/** Called right after a lead enters a pipeline. Queues (or sends) the contact ack per
 *  business hours, and alerts the assigned rep immediately if one was auto-assigned. */
export async function notifyOnCapture(args: { organizationId: string; leadId: string; ownerId?: string | null }) {
  const org = await prisma.organization.findUnique({ where: { id: args.organizationId }, select: { businessHours: true } });
  const hours = getBusinessHours(org?.businessHours);
  const delayMinutes = minutesUntilOpen(hours);

  if (delayMinutes > 0) {
    await enqueueJob({ kind: "lead-ack", organizationId: args.organizationId, leadId: args.leadId }, delayMinutes * 60_000);
  } else {
    await sendCaptureAck(args.organizationId, args.leadId).catch((e) => console.error("[notify] capture ack failed:", e));
  }

  if (args.ownerId) {
    const lead = await prisma.lead.findFirst({
      where: { id: args.leadId, organizationId: args.organizationId },
      select: { firstName: true, lastName: true, email: true, phone: true, company: true },
    });
    if (lead) await alertAssignedRep(args.organizationId, args.ownerId, lead);
  }
}
