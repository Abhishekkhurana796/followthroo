/**
 * A workspace's own day.
 *
 * Every daily allowance — LinkedIn's invite cap, the note allowance, plan credits
 * — resets at midnight where the workspace is, not where the server is. On
 * Vercel the server is UTC, which is half past five in the morning in India, so
 * a "day" used to straddle two working days. The offset is the one business
 * hours already carry (IST unless the workspace changed it), and it lives here
 * once so every reset happens at the same moment.
 */
import { prisma } from "./db";

export async function orgOffsetMinutes(organizationId: string): Promise<number> {
  // Imported lazily: notify pulls in the channels, and the LinkedIn channel
  // imports the queue, which imports this file.
  const { getBusinessHours } = await import("./notify");
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { businessHours: true } });
  return getBusinessHours(org?.businessHours).timezoneOffsetMinutes;
}

/** Midnight today in the organization's own time zone. */
export async function startOfOrgDay(organizationId: string, now = new Date()) {
  const offsetMs = (await orgOffsetMinutes(organizationId)) * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs);
}

/** The calendar day at `at` for a known offset, as "YYYY-MM-DD" — no database round trip. */
export function dayKeyAt(offsetMinutes: number, at = new Date()) {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** The organization's calendar day at `now`, as "YYYY-MM-DD". */
export async function orgDayKey(organizationId: string, now = new Date()) {
  return dayKeyAt(await orgOffsetMinutes(organizationId), now);
}
