import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, requireDb } from "@/lib/http";
import { logActivity, suppress } from "@/lib/crm";
import { env } from "@/lib/env";
import { verifyTwilioSignature } from "@/lib/webhook-auth";
import { normalizePhone } from "@/lib/identity";

export const runtime = "nodejs";

/**
 * Twilio WhatsApp webhook (application/x-www-form-urlencoded).
 *
 * Carries two unrelated things on one endpoint: delivery *status* callbacks for
 * messages we sent, and genuine *inbound* messages from a contact. They are
 * handled separately — treating them as one is how a "delivered" callback used
 * to overwrite a real reply.
 *
 * Signed by Twilio; unsigned requests are rejected. Before that check existed,
 * anyone could POST `Body=stop` and unsubscribe another workspace's contacts.
 */
export async function POST(req: NextRequest) {
  const guard = requireDb();
  if (guard) return guard;

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v.toString();

  // Twilio signs the URL it was configured with, which is the public app URL —
  // behind Vercel's proxy req.url can be an internal hostname.
  const signedUrl = `${env.appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), signedUrl, params, env.twilio.authToken)) {
    return fail("Invalid signature.", 401);
  }

  const from = (params.From ?? params.WaId ?? "").replace("whatsapp:", "");
  const status = params.MessageStatus ?? params.SmsStatus ?? "";
  const body = (params.Body ?? "").trim();
  if (!from) return ok({ ignored: true });

  // ---- Which tenant does this belong to? ----
  //
  // This used to be `findFirst({ phone: { contains: from.slice(-8) } })` with no
  // organizationId at all — so an inbound message matched the FIRST lead in the
  // entire database whose number happened to end in those eight digits, quite
  // possibly another customer's. A reply could be logged against the wrong
  // workspace, and "stop" could suppress the wrong company's contact.
  //
  // It cannot simply be scoped, because there is one shared platform number
  // today: the webhook carries no tenant signal at all. Until each workspace
  // connects its own number, the honest behaviour is to match exactly and refuse
  // to guess when the answer is ambiguous.
  // Match through ContactIdentity rather than Lead.phone: identity values are
  // normalised at write time (lib/identity.ts), which is the whole point of the
  // graph, whereas Lead.phone holds whatever the CSV or the webhook supplied.
  // Falls back to an exact Lead.phone match for contacts that predate it.
  const normalized = normalizePhone(from);
  const candidates = normalized
    ? [
        ...(await prisma.contactIdentity.findMany({
          where: { kind: "phone", value: normalized },
          select: { leadId: true, organizationId: true },
        })).map((i) => ({ id: i.leadId, organizationId: i.organizationId as string | null })),
        ...(await prisma.lead.findMany({
          where: { phone: { in: [normalized, from] }, organizationId: { not: null } },
          select: { id: true, organizationId: true },
        })),
      ]
    : [];

  if (candidates.length === 0) return ok({ processed: true, matched: false });

  const orgs = new Set(candidates.map((c) => c.organizationId));
  if (orgs.size > 1) {
    // Two customers have the same contact. Writing to either is a coin flip, and
    // a wrong suppression is unrecoverable — so do neither, and say so.
    console.warn(`[whatsapp] ${orgs.size} workspaces have this number; refusing to guess. Per-tenant numbers fix this.`);
    return ok({ processed: true, matched: false, ambiguous: true });
  }

  const lead = candidates[0];
  const orgId = lead.organizationId!;

  // An inbound message carries a Body; a status callback does not. This is the
  // distinction that keeps a delivery receipt from being logged as a reply.
  const isInbound = body.length > 0;

  if (isInbound && ["stop", "unsubscribe", "stop all"].includes(body.toLowerCase())) {
    await suppress(orgId, { phone: from }, "unsubscribe");
  }

  await logActivity({
    organizationId: orgId,
    leadId: lead.id,
    type: isInbound ? "replied" : status || "whatsapp_event",
    channel: "whatsapp",
    meta: { status: status || undefined, body: isInbound ? body : undefined },
  });

  return ok({ processed: true, kind: isInbound ? "inbound" : "status" });
}
