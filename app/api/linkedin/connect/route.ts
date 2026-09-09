import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { getOrCreateAccount, genToken } from "@/lib/linkedin/auth";
import { queueStats } from "@/lib/linkedin/queue";
import { connectionState, linkedinOAuthConfigured, LINKEDIN_SCOPES } from "@/lib/linkedin/oauth";

export const runtime = "nodejs";

// GET — this member's LinkedIn extension status, token, caps, and live queue counts.
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const account = await getOrCreateAccount(ctx.orgId, ctx.userId);
  const stats = await queueStats(ctx.orgId);
  return ok({
    extToken: account.extToken,
    status: account.status,
    liMemberName: account.liMemberName,
    // The connected LinkedIn identity. Note what is absent: the access token
    // never leaves the server. A browser gets a name, a photo and a date.
    account: {
      state: connectionState(account),
      configured: linkedinOAuthConfigured(),
      memberName: account.liMemberName,
      pictureUrl: account.liPictureUrl,
      email: account.liEmail,
      expiresAt: account.liTokenExpiresAt,
      connectedAt: account.liConnectedAt,
      scopes: account.liScopes,
      canPost: account.liScopes.includes("w_member_social"),
      requestedScopes: LINKEDIN_SCOPES.split(" "),
    },
    autoSend: account.autoSend,
    lastSeenAt: account.lastSeenAt,
    dailyInviteCap: account.dailyInviteCap,
    minDelaySec: account.minDelaySec,
    maxDelaySec: account.maxDelaySec,
    queue: stats,
  });
}

const Body = z.object({
  action: z.enum(["rotate", "update", "disconnect", "stop_all"]),
  /** Whether the extension clicks Send itself. See LinkedInAccount.autoSend. */
  autoSend: z.boolean().optional(),
  dailyInviteCap: z.number().int().min(1).max(50).optional(),
  minDelaySec: z.number().int().min(10).max(600).optional(),
  maxDelaySec: z.number().int().min(15).max(900).optional(),
});

// POST — rotate the token or update caps/pacing.
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  const account = await getOrCreateAccount(ctx.orgId, ctx.userId);
  const data: Record<string, unknown> = {};
  // Disconnecting forgets the tokens outright rather than marking a flag. A
  // credential we no longer need is a liability we no longer need to hold, and
  // the member can reconnect in two clicks.
  if (parsed.data.action === "disconnect") {
    await prisma.linkedInAccount.update({
      where: { id: account.id },
      data: {
        liMemberId: null,
        liPictureUrl: null,
        liEmail: null,
        liAccessToken: null,
        liRefreshToken: null,
        liTokenExpiresAt: null,
        liScopes: [],
        liConnectedAt: null,
      },
    });
    return ok({ disconnected: true });
  }

  /**
   * The panic button. Turns automatic sending off AND clears everything already
   * queued, in that order.
   *
   * Turning the switch off alone is not enough to feel safe: a queue of eighty
   * pending invites would still be sitting there, and the person pressing this
   * wants it to stop, not to pause.
   */
  if (parsed.data.action === "stop_all") {
    await prisma.linkedInAccount.update({ where: { id: account.id }, data: { autoSend: false } });
    const cleared = await prisma.linkedInAction.updateMany({
      where: { organizationId: ctx.orgId, status: { in: ["pending", "in_progress", "drafted"] } },
      data: { status: "skipped", result: "cancelled — everything stopped from the app" },
    });
    return ok({ stopped: true, cleared: cleared.count });
  }

  if (parsed.data.autoSend !== undefined) data.autoSend = parsed.data.autoSend;

  if (parsed.data.action === "rotate") {
    data.extToken = genToken();
    data.status = "pending";
    data.liMemberName = null;
  }
  if (parsed.data.dailyInviteCap !== undefined) data.dailyInviteCap = parsed.data.dailyInviteCap;
  if (parsed.data.minDelaySec !== undefined) data.minDelaySec = parsed.data.minDelaySec;
  if (parsed.data.maxDelaySec !== undefined) data.maxDelaySec = parsed.data.maxDelaySec;

  const updated = await prisma.linkedInAccount.update({ where: { id: account.id }, data });
  return ok({ extToken: updated.extToken, status: updated.status, dailyInviteCap: updated.dailyInviteCap, minDelaySec: updated.minDelaySec, maxDelaySec: updated.maxDelaySec });
}
