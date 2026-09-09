import type { RenderedMessage } from "../templates";
import type { IdentityInput } from "../identity";

export interface Lead {
  id: string;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  firstName?: string | null;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  /** The RFC-822 Message-ID actually placed on the wire, when the channel sets one. */
  rfcMessageId?: string;
  /** set when the channel is not configured or the send was skipped */
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * What an adapter can actually do, declared rather than assumed.
 *
 * The sequence engine reads this instead of hardcoding per-channel rules — so
 * WhatsApp's 24-hour session window and DLT-style template gating are facts the
 * adapter states about itself, not conditionals scattered through the caller.
 */
export interface AdapterCapabilities {
  send: boolean;
  receive: boolean;
  /** Provider requires pre-approved templates (WhatsApp, India SMS DLT). */
  templates: boolean;
  /**
   * Free-form replies are only allowed within this many hours of the contact's
   * last inbound message; outside it, only an approved template may be sent.
   */
  sessionWindowHours?: number;
  /** Explicit opt-in is required before the first outbound message. */
  requiresOptIn: boolean;
  /** Provider or policy ceiling, per account, per day. */
  maxPerDay?: number;
  /** Delivery happens outside our servers (e.g. the LinkedIn browser extension). */
  humanAssisted?: boolean;
}

/**
 * A normalised inbound event. Every adapter — messaging channel or lead
 * aggregator — produces this exact shape, which is what lets one identity graph
 * and one conversation timeline serve all of them.
 */
export interface InboundEvent {
  /** Identifiers to resolve the contact by; at least one is required. */
  identities: IdentityInput[];
  channel: "email" | "linkedin" | "whatsapp" | "social";
  direction: "inbound" | "outbound";
  /** Provider's own id — the dedupe key for webhook retries. */
  externalId?: string;
  subject?: string;
  body?: string;
  occurredAt?: Date;
  profile?: { firstName?: string | null; lastName?: string | null; company?: string | null; title?: string | null };
  /** Machine key for LeadSource — meta_lead_ads, indiamart, web_form, … */
  sourceKey?: string;
  meta?: Record<string, unknown>;
}

/**
 * Per-send metadata the campaign engine knows and an adapter needs, but which
 * does not belong on the rendered message.
 *
 * It exists because `send` carried only the lead and the rendered text, so a
 * LinkedIn action reached the queue with no idea which campaign or which gesture
 * it came from — every one was written as `campaignId: null, type: "auto"`, and
 * per-campaign caps silently applied to nothing.
 *
 * Optional and trailing on purpose: every existing caller (the agent, notify,
 * inbox replies, template test-sends) keeps compiling untouched.
 */
export interface SendContext {
  /** The campaign this send belongs to — LinkedIn's per-campaign caps key off it. */
  campaignId?: string;
  /** The sequence node, so an action can be traced back to the step that made it. */
  nodeId?: string;
  /** LinkedIn only: which gesture the extension should draft. */
  linkedinAction?: "invite" | "message" | "auto";
}

/**
 * The adapter contract from the product PRD.
 *
 * Inbound-only sources (lead aggregators, ad platforms) implement `receive` and
 * `capabilities` and simply omit `send`, which is why both are optional here
 * rather than forcing stub throws into every ingestion adapter.
 */
export interface Adapter {
  name: string;
  capabilities(): AdapterCapabilities;
  isConfigured(): boolean;
  /**
   * `orgId` is required for any adapter that loads per-tenant credentials: the account
   * id alone is a bare uuid, so without the owning org in the lookup one tenant could
   * send through another's connected mailbox or number.
   */
  send?(lead: Lead, rendered: RenderedMessage, account?: string, orgId?: string, rfcMessageId?: string, ctx?: SendContext): Promise<SendResult>;
  /** Parse a provider payload into normalised events. */
  receive?(payload: unknown, headers?: Headers): Promise<InboundEvent[]>;
  /** Verify a webhook signature before anything is parsed or trusted. */
  verify?(rawBody: string, headers: Headers): boolean;
}

/**
 * Retained so the existing send path keeps compiling unchanged. Outbound
 * channels satisfy both this and `Adapter`.
 */
export interface Channel {
  name: "email" | "linkedin" | "whatsapp" | "social";
  isConfigured(): boolean;
  send(lead: Lead, rendered: RenderedMessage, account?: string, orgId?: string, rfcMessageId?: string, ctx?: SendContext): Promise<SendResult>;
  capabilities?(): AdapterCapabilities;
  receive?(payload: unknown, headers?: Headers): Promise<InboundEvent[]>;
  verify?(rawBody: string, headers: Headers): boolean;
}
