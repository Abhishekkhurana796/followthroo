import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/crm";
import { PIXEL } from "@/lib/tracking";
import { LIMITS, clientIp, hit } from "@/lib/api-ratelimit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ messageId: string }> };

function pixelResponse() {
  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Length": String(PIXEL.length),
    },
  });
}

// GET /api/track/open/[messageId] — 1×1 pixel; records an open the first time.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { messageId } = await params;

  // Over the limit, the pixel is still served — a real recipient's email must
  // never show a broken image — but nothing is looked up or written. This is an
  // unauthenticated route, and a flood of it was a free way to load the database.
  const { ok: withinLimit } = await hit(`track:${clientIp(req)}`, LIMITS.tracking);
  if (!withinLimit) return pixelResponse();

  try {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (message?.organizationId) {
      // Only record the first open per message (keeps unique-open rate meaningful).
      const already = await prisma.activityLog.findFirst({ where: { messageId, type: "opened" } });
      if (!already) {
        await logActivity({
          organizationId: message.organizationId,
          leadId: message.leadId,
          campaignId: message.campaignId ?? undefined,
          messageId,
          type: "opened",
          channel: message.channel,
        });
        if (message.status === "sent") {
          await prisma.message.update({ where: { id: messageId }, data: { status: "delivered" } });
        }
      }
    }
  } catch {
    // Never let tracking break image delivery.
  }
  return pixelResponse();
}
