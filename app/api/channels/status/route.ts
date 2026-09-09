import type { NextRequest } from "next/server";
import { ok } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { env, configured } from "@/lib/env";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** Last 4 digits only — this is an authenticated route, but no reason to expose the
 *  full sending number to every member who can view Settings. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/^whatsapp:/, "");
  return digits.length > 4 ? `••• ${digits.slice(-4)}` : digits;
}

// GET /api/channels/status — one answer for the Channels screen: is each way of
// reaching someone actually working, and where do leads come from.
//
// Credentials themselves stay in env vars (CLAUDE.md: secrets never move into the
// database from a settings UI) — this only ever reports status + a masked identifier.
// Counts, never rows: a SendingAccount carries `pass`, `refreshToken` and
// `dkimPrivateKey`, and must never reach a browser.
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  const [mailboxes, linkedIn, leadSources] = await Promise.all([
    prisma.sendingAccount.count({ where: { organizationId: ctx.orgId } }),
    prisma.linkedInAccount.findFirst({
      where: { organizationId: ctx.orgId, userId: ctx.userId },
      select: { status: true, liMemberName: true, lastSeenAt: true },
    }),
    prisma.leadSource.count({ where: { organizationId: ctx.orgId } }).catch(() => 0),
  ]);

  return ok({
    email: {
      configured: mailboxes > 0,
      mailboxes,
    },
    linkedin: {
      configured: linkedIn?.status === "connected",
      memberName: linkedIn?.liMemberName ?? null,
      lastSeenAt: linkedIn?.lastSeenAt ?? null,
    },
    whatsapp: {
      configured: configured.whatsapp,
      fromMasked: env.twilio.whatsappFrom ? maskPhone(env.twilio.whatsappFrom) : null,
    },
    sms: {
      // Deliberately unbuilt — DLT registration is an external, days-to-weeks process
      // (dev PRD §3.9), not something code can stand up. See docs/channels.md.
      configured: false,
    },
    leadSources: { count: leadSources },
  });
}
