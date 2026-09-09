import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { ingestMany } from "@/lib/ingest";
import { INBOUND_ADAPTERS, metaLeadAdsAdapter, googleAdsAdapter, type InboundAdapterKey } from "@/lib/channels/inbound";
import { ingestKeyFor } from "@/lib/ingest-key";
import { safeEqual } from "@/lib/webhook-auth";

export const runtime = "nodejs";

/**
 * One webhook endpoint for every inbound lead source:
 *
 *   POST /api/inbound/<source>?org=<organizationId>&key=<ingestKey>
 *
 * These are called by third parties, so there is no session — the org is named
 * in the query and authenticated by a per-org key. Adding an aggregator means
 * registering a field mapping, not writing a route.
 */
function authorize(req: NextRequest): { orgId: string } | Response {
  const orgId = req.nextUrl.searchParams.get("org");
  const key = req.nextUrl.searchParams.get("key");
  if (!orgId) return fail("Missing `org`.", 400);
  // The ingest key is derived from the app secret + org id, so it is stable,
  // revocable by rotating the secret, and needs no extra table.
  const expected = ingestKeyFor(orgId);
  // Constant-time, matching the Meta signature path in lib/channels/inbound.ts.
  if (!safeEqual(key, expected)) return fail("Invalid ingest key.", 401);
  return { orgId };
}

/** Meta verifies a new webhook with a GET challenge before it will send events. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.get("hub.mode") === "subscribe") {
    const token = params.get("hub.verify_token");
    if (token && token === process.env.META_VERIFY_TOKEN) {
      return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
    }
    return fail("Bad verify token.", 403);
  }
  return fail("Unsupported.", 400);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  const auth = authorize(req);
  if (auth instanceof Response) return auth;

  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { id: true } });
  if (!org) return fail("Unknown organization.", 404);

  // Read the body as text first: signature verification must run against the
  // exact bytes sent, not a re-serialised object.
  const raw = await req.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    // Some senders post form-encoded rather than JSON.
    payload = Object.fromEntries(new URLSearchParams(raw));
  }

  if (source === "meta_lead_ads") {
    if (!metaLeadAdsAdapter.verify(raw, req.headers)) return fail("Bad signature.", 401);
    const ids = metaLeadAdsAdapter.leadgenIds(payload);
    const events = [];
    for (const id of ids) {
      const lead = await fetchMetaLead(id);
      const e = lead ? metaLeadAdsAdapter.fromGraphLead(lead) : null;
      if (e) events.push(e);
    }
    return ok(await ingestMany(auth.orgId, events));
  }

  if (source === "google_ads") {
    if (!googleAdsAdapter.verify(payload)) return fail("Bad google_key.", 401);
    return ok(await ingestMany(auth.orgId, await googleAdsAdapter.receive(payload)));
  }

  const adapter = INBOUND_ADAPTERS[source as InboundAdapterKey];
  if (!adapter) return fail(`Unknown source "${source}".`, 404);

  const events = await adapter.receive(payload);
  if (events.length === 0) {
    // Acknowledge rather than error: a 4xx makes providers retry a payload that
    // will never map, and some disable the webhook after repeated failures.
    return ok({ received: 0, created: 0, merged: 0, duplicates: 0, suppressed: 0, note: "No usable identifiers." });
  }
  return ok(await ingestMany(auth.orgId, events));
}

/** The webhook carries only an id; the field values need a Graph API call. */
async function fetchMetaLead(leadgenId: string) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as { id?: string; field_data?: { name: string; values: string[] }[] };
  } catch {
    return null;
  }
}
