/**
 * Inbound lead-source adapters.
 *
 * The product PRD calls for onboarding a new aggregator to mean "fill in a
 * webhook URL and a field mapping", not "write new integration code". So the
 * only bespoke piece per source is a mapping from its payload keys to ours;
 * everything downstream — identity resolution, dedupe, source tagging, pipeline
 * entry — is shared.
 */
import crypto from "node:crypto";
import type { InboundEvent, AdapterCapabilities } from "./types";
import type { IdentityInput } from "../identity";

export type FieldMap = {
  email?: string[];
  phone?: string[];
  firstName?: string[];
  lastName?: string[];
  fullName?: string[];
  company?: string[];
  title?: string[];
  message?: string[];
};

/** Case-insensitive lookup across a few candidate key names. */
function pick(obj: Record<string, unknown>, keys: string[] = []): string | null {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase().replace(/[\s_-]/g, ""), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase().replace(/[\s_-]/g, ""));
    if (!real) continue;
    const v = obj[real];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

const DEFAULT_MAP: FieldMap = {
  email: ["email", "emailaddress", "email_address", "e-mail", "sender_email", "buyer_email"],
  phone: ["phone", "mobile", "phonenumber", "phone_number", "contact", "mobilenumber", "sender_mobile", "buyer_phone"],
  firstName: ["firstname", "first_name", "fname", "given_name"],
  lastName: ["lastname", "last_name", "lname", "family_name"],
  fullName: ["name", "fullname", "full_name", "sender_name", "buyer_name", "contact_person"],
  company: ["company", "companyname", "company_name", "organisation", "organization", "sender_company", "glusr_usr_company"],
  title: ["title", "jobtitle", "job_title", "designation"],
  message: ["message", "comments", "enquiry", "query", "subject", "requirement", "sender_message"],
};

/**
 * Turn any flat-ish payload into a normalised event. Unknown shapes degrade to
 * "whatever identifiers we could find" rather than throwing, because a dropped
 * lead is worse than a partially-mapped one.
 */
export function mapPayload(
  raw: Record<string, unknown>,
  sourceKey: string,
  map: FieldMap = {},
): InboundEvent | null {
  const m: FieldMap = { ...DEFAULT_MAP, ...map };
  const email = pick(raw, m.email);
  const phone = pick(raw, m.phone);
  const identities: IdentityInput[] = [];
  if (email) identities.push({ kind: "email", value: email });
  if (phone) identities.push({ kind: "phone", value: phone });
  // No way to identify the person means no way to avoid duplicating them.
  if (identities.length === 0) return null;

  const explicitFirst = pick(raw, m.firstName);
  const explicitLast = pick(raw, m.lastName);
  const split = splitName(pick(raw, m.fullName));

  return {
    identities,
    channel: "email",
    direction: "inbound",
    sourceKey,
    subject: `New enquiry via ${sourceKey.replace(/_/g, " ")}`,
    body: pick(raw, m.message) ?? undefined,
    occurredAt: new Date(),
    profile: {
      firstName: explicitFirst ?? split.firstName,
      lastName: explicitLast ?? split.lastName,
      company: pick(raw, m.company),
      title: pick(raw, m.title),
    },
    meta: { raw },
  };
}

const INBOUND_CAPS: AdapterCapabilities = {
  send: false,
  receive: true,
  templates: false,
  requiresOptIn: false,
};

/** Website / landing-page forms posting straight to us. */
export const webFormAdapter = {
  name: "web_form",
  capabilities: () => INBOUND_CAPS,
  isConfigured: () => true,
  async receive(payload: unknown): Promise<InboundEvent[]> {
    if (!payload || typeof payload !== "object") return [];
    const e = mapPayload(payload as Record<string, unknown>, "web_form");
    return e ? [e] : [];
  },
};

/**
 * Meta Lead Ads.
 *
 * The webhook carries only a `leadgen_id`; the field values need a second Graph
 * API call. That fetch is deliberately injected so the adapter stays unit-testable
 * and the route decides how to authenticate.
 */
export const metaLeadAdsAdapter = {
  name: "meta_lead_ads",
  capabilities: () => INBOUND_CAPS,
  isConfigured: () => !!process.env.META_APP_SECRET,

  /** Meta signs payloads as `sha256=<hmac>` over the raw body. */
  verify(rawBody: string, headers: Headers): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return false;
    const sig = headers.get("x-hub-signature-256");
    if (!sig?.startsWith("sha256=")) return false;
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const got = sig.slice(7);
    // Length check first: timingSafeEqual throws on a mismatch.
    if (got.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  },

  /** Extract the leadgen ids a notification refers to. */
  leadgenIds(payload: unknown): string[] {
    const p = payload as { entry?: { changes?: { field?: string; value?: { leadgen_id?: string } }[] }[] };
    const out: string[] = [];
    for (const entry of p?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === "leadgen" && change.value?.leadgen_id) out.push(change.value.leadgen_id);
      }
    }
    return out;
  },

  /** Convert a fetched lead (`field_data` array) into a normalised event. */
  fromGraphLead(lead: { id?: string; field_data?: { name: string; values: string[] }[] }): InboundEvent | null {
    const flat: Record<string, unknown> = {};
    for (const f of lead.field_data ?? []) flat[f.name] = f.values?.[0];
    const e = mapPayload(flat, "meta_lead_ads");
    if (e && lead.id) e.externalId = `meta:${lead.id}`;
    return e;
  },
};

/**
 * Google Ads Lead Form Extensions (dev PRD §3.5).
 *
 * The webhook posts a `google_key` shared secret (set on the lead form asset's webhook
 * config, not an HMAC over the body like Meta) plus `user_column_data`: an array of
 * `{column_name, string_value}` rather than a flat object — flattened here before handing
 * off to the shared `mapPayload`, so identity/dedupe/pipeline-entry stay common.
 */
export const googleAdsAdapter = {
  name: "google_ads",
  capabilities: () => INBOUND_CAPS,
  isConfigured: () => !!process.env.GOOGLE_ADS_WEBHOOK_KEY,

  verify(payload: unknown): boolean {
    const key = process.env.GOOGLE_ADS_WEBHOOK_KEY;
    if (!key) return false;
    const googleKey = (payload as { google_key?: string } | null)?.google_key;
    return !!googleKey && googleKey === key;
  },

  async receive(payload: unknown): Promise<InboundEvent[]> {
    if (!payload || typeof payload !== "object") return [];
    const p = payload as { lead_id?: string; user_column_data?: { column_name?: string; string_value?: string }[] };
    const flat: Record<string, unknown> = {};
    for (const col of p.user_column_data ?? []) {
      if (col.column_name) flat[col.column_name] = col.string_value;
    }
    const e = mapPayload(flat, "google_ads", {
      email: ["EMAIL"],
      phone: ["PHONE_NUMBER"],
      fullName: ["FULL_NAME"],
      company: ["COMPANY_NAME"],
      title: ["JOB_TITLE"],
    });
    if (e && p.lead_id) e.externalId = `google_ads:${p.lead_id}`;
    return e ? [e] : [];
  },
};

/**
 * Aggregators without a documented public API (IndiaMART push, JustDial,
 * Sulekha, TradeIndia). Payload shape is account-dependent, so this validates
 * nothing about structure and maps defensively — per the developer PRD's
 * warning to assume nothing about schema stability.
 */
export function aggregatorAdapter(sourceKey: string, map: FieldMap = {}) {
  return {
    name: sourceKey,
    capabilities: () => INBOUND_CAPS,
    isConfigured: () => true,
    async receive(payload: unknown): Promise<InboundEvent[]> {
      if (!payload || typeof payload !== "object") return [];
      // Some senders wrap one or many leads in a container key.
      const p = payload as Record<string, unknown>;
      const container = ["leads", "RESPONSE", "response", "data", "items"].find((k) => Array.isArray(p[k]));
      const rows = container ? (p[container] as Record<string, unknown>[]) : [p];
      return rows
        .map((r) => mapPayload(r, sourceKey, map))
        .filter((e): e is InboundEvent => e !== null);
    },
  };
}

export const indiamartAdapter = aggregatorAdapter("indiamart", {
  email: ["SENDER_EMAIL", "sender_email"],
  phone: ["SENDER_MOBILE", "sender_mobile", "SENDER_PHONE"],
  fullName: ["SENDER_NAME", "sender_name"],
  company: ["SENDER_COMPANY", "sender_company"],
  message: ["QUERY_MESSAGE", "query_message", "SUBJECT"],
});

export const justdialAdapter = aggregatorAdapter("justdial", {
  email: ["email", "EMAIL"],
  phone: ["mobile", "MOBILE", "phone"],
  // `prefix` is normally only Mr/Ms. Treating it as a person name made an
  // otherwise valid phone-only JustDial lead look like somebody called "Mr".
  fullName: ["name", "NAME", "customer_name", "CUSTOMER_NAME", "contact_person"],
  message: ["category", "CATEGORY", "area"],
});

// Sulekha and TradeIndia (dev PRD §3.8): same "no documented public API" pattern as
// JustDial. Field names below are a best-effort guess at common aggregator conventions,
// not verified against a real payload — treat as a starting point to adjust once an
// account's actual webhook (or email) sample is in hand.
export const sulekhaAdapter = aggregatorAdapter("sulekha", {
  email: ["email", "customer_email", "user_email"],
  phone: ["mobile", "phone", "customer_mobile", "user_mobile"],
  fullName: ["name", "customer_name", "user_name"],
  message: ["message", "requirement", "enquiry_details"],
});

export const tradeindiaAdapter = aggregatorAdapter("tradeindia", {
  email: ["email", "EMAIL", "buyer_email"],
  phone: ["mobile", "MOBILE", "buyer_mobile", "phone"],
  fullName: ["name", "NAME", "buyer_name"],
  company: ["company", "buyer_company"],
  message: ["message", "requirement", "product_name"],
});

// google_ads is deliberately NOT in this map — like meta_lead_ads, it needs its shared
// key/signature checked before receive() runs, so the route special-cases it rather than
// going through the generic dispatch (which would call receive() unauthenticated).
export const INBOUND_ADAPTERS = {
  web_form: webFormAdapter,
  indiamart: indiamartAdapter,
  justdial: justdialAdapter,
  sulekha: sulekhaAdapter,
  tradeindia: tradeindiaAdapter,
} as const;

export type InboundAdapterKey = keyof typeof INBOUND_ADAPTERS;
