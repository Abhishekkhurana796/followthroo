/**
 * CRM helpers — mirrors docs/crm-data-model.md.
 * Thin wrappers over Prisma; every send path must call `isSuppressed` first.
 */
import { prisma } from "./db";
import { Prisma, type Channel } from "@prisma/client";
import { appendLedgerEntry } from "./compliance-ledger";

export async function isSuppressed(
  orgId: string,
  opts: {
    email?: string | null;
    phone?: string | null;
    linkedinUrl?: string | null;
  }
): Promise<boolean> {
  const or: Record<string, string>[] = [];
  if (opts.email) or.push({ email: opts.email });
  if (opts.phone) or.push({ phone: opts.phone });
  if (opts.linkedinUrl) or.push({ linkedinUrl: opts.linkedinUrl });
  if (or.length === 0) return false;
  const hit = await prisma.suppression.findFirst({ where: { organizationId: orgId, OR: or } });
  return !!hit;
}

export async function suppress(
  orgId: string,
  target: { email?: string; phone?: string; linkedinUrl?: string },
  reason: "unsubscribe" | "bounce" | "gdpr" | "manual"
) {
  const row = await prisma.suppression.upsert({
    where: { organizationId_email: { organizationId: orgId, email: target.email ?? `no-email-${Date.now()}` } },
    create: { ...target, organizationId: orgId, reason },
    update: { reason },
  });
  // Best-effort — the suppression itself must never fail because the ledger did.
  await appendLedgerEntry(orgId, "suppression", { ...target, reason }).catch((e) =>
    console.error("[compliance-ledger] append failed:", e),
  );
  return row;
}

export async function logActivity(input: {
  organizationId?: string | null;
  leadId: string;
  campaignId?: string;
  messageId?: string;
  type: string;
  channel?: Channel;
  meta?: Record<string, unknown>;
}) {
  return prisma.activityLog.create({
    data: {
      organizationId: input.organizationId ?? undefined,
      leadId: input.leadId,
      campaignId: input.campaignId,
      messageId: input.messageId,
      type: input.type,
      channel: input.channel,
      meta: (input.meta ?? {}) as Prisma.InputJsonValue,
    },
  });
}

