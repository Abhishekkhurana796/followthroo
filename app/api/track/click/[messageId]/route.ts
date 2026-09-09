import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/crm";
import { env } from "@/lib/env";
import { verifyClickTarget } from "@/lib/tracking";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ messageId: string }> };

// GET /api/track/click/[messageId]?u=<encoded url> — records a click, then 302s to the URL.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { messageId } = await params;
  const target = req.nextUrl.searchParams.get("u");
  const signature = req.nextUrl.searchParams.get("s");

  const message = await prisma.message.findUnique({ where: { id: messageId } }).catch(() => null);

  // Only ever redirect somewhere this message actually pointed. Anything else
  // makes this an open redirect on an unauthenticated route — a phishing link
  // wearing our domain. Fall back to the app home rather than erroring, so a
  // legitimate recipient is never left staring at a 400.
  let dest = env.appUrl;
  if (target) {
    try {
      const u = new URL(target);
      const schemeOk = u.protocol === "http:" || u.protocol === "https:";
      // Signed links are the current path. Links in mail sent before signing
      // existed carry no `s`, so fall back to proving the URL was in that
      // message's own rendered body — which an attacker cannot arrange.
      const allowed = schemeOk && (verifyClickTarget(messageId, target, signature) || !!message?.renderedBody?.includes(target));
      if (allowed) dest = target;
    } catch {
      /* keep fallback */
    }
  }

  try {
    if (message?.organizationId) {
      await logActivity({
        organizationId: message.organizationId,
        leadId: message.leadId,
        campaignId: message.campaignId ?? undefined,
        messageId,
        type: "clicked",
        channel: message.channel,
        meta: { url: target ?? undefined },
      });
      if (message.status === "sent") {
        await prisma.message.update({ where: { id: messageId }, data: { status: "delivered" } });
      }
    }
  } catch {
    // Redirect regardless — never trap the recipient.
  }

  return NextResponse.redirect(dest, { status: 302 });
}
