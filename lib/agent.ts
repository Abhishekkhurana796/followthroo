/**
 * Outreach orchestration agent.
 *
 * Runs on Anthropic Claude (CLAUDE.md's standing rule for the agent layer — this
 * previously ran NVIDIA's OpenAI-compatible endpoint despite docs/marketing claiming
 * Claude all along; now it actually does). Four tools, all funneling through the SAME
 * rate-limited/suppression-checked paths every manual action uses, so the agent can never
 * exceed platform limits or bypass consent:
 *
 *   send_message        — dispatch now, via the same safeSend() every channel uses.
 *   draft_message        — write it, don't send it. The model reaches for this instead of
 *                          send_message when it isn't confident the message is ready to go
 *                          out unattended (confidence-gated autonomy, product PRD §7);
 *                          a human approves from the Drafts panel on the Agent page.
 *   move_stage           — advance a contact's pipeline stage with actorKind:"ai", which is
 *                          what makes the PRD's headline metric (share of moves driven by AI
 *                          vs. a rep updating a dropdown — see getAiMoveShare in
 *                          lib/pipeline.ts) measurable instead of permanently stuck at 0%.
 *   update_lead_fields    — write budget/timeline/decision-maker signals straight onto the
 *                          Lead record from the conversation — the "conversational
 *                          qualification" capability the product PRD calls the single
 *                          biggest gap in the category.
 *
 * classifyReplyIntent() is a separate, smaller-model call — reply-intent tagging runs on
 * every inbound reply, not just inside a campaign run, so it doesn't belong in this loop.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { env, configured } from "./env";
import { prisma } from "./db";
import { safeSend } from "./channels";
import { defaultSendingAccountId } from "./channels/email";
import { renderMessage } from "./templates";
import { logActivity } from "./crm";
import { senderNameForUser, senderNameForCampaign, senderNameForAccount } from "./sender";
import { moveToStage, BackwardMoveNeedsReason } from "./pipeline";
import { recomputeAndSaveLeadScore } from "./scoring";
import type { Channel } from "./channels/types";
import { randomUUID } from "node:crypto";

function systemPrompt(confidenceThreshold: number, availableChannels: string): string {
  return `You orchestrate multi-channel outreach and pipeline qualification for Followthroo.

Rules (never violate):
- Only act on leads provided to you. Never invent recipients, emails, phones, or consent.
- Respect suppression: if a send comes back "suppressed" or "rate-limited", skip and move on.
- Hard limits: 40 emails/hour, 20 LinkedIn invites/day, 250 WhatsApp/day (enforced by the tool).
- Available channels right now: ${availableChannels}. LinkedIn queues for a human to review
  and send from their own session — it is never instant, factor that into urgency calls.
- Prefer whichever channel the conversation history shows this lead actually responds on;
  fall back to email first when there's no history to go on.

Confidence-gated sending (product PRD §7):
- Call send_message only when you're confident (roughly ${Math.round(confidenceThreshold * 100)}%+
  sure) the message is accurate, on-brand, and safe to leave unattended.
- Otherwise call draft_message with the identical content — a human reviews and sends it
  from the Agent page. When in doubt, draft; a bad auto-send is worse than a delayed one.

Conversational qualification:
- When the conversation history (given per lead below) reveals a budget, a timeline, or
  that you're talking to an actual decision-maker, call update_lead_fields to record it —
  this is what should move a lead from "enquiry" to "qualified", not a rep remembering to
  update a dropdown.
- When a lead's signals and conversation clearly warrant it, call move_stage using the
  stage ids listed for that lead. Moving backward requires a reason.

Keep copy personalized and human. Call at most one tool per lead per turn, then continue
or summarize.`;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "send_message",
    description: "Send one outreach message to a lead on a channel now. Enforces suppression + rate limits internally.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        channel: { type: "string", enum: ["email", "linkedin", "whatsapp", "social"] },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["leadId", "channel", "body"],
    },
  },
  {
    name: "draft_message",
    description:
      "Write a message for a lead WITHOUT sending it — used when you aren't confident enough to send unattended. A human approves it from the Agent page's Drafts panel.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        channel: { type: "string", enum: ["email", "linkedin", "whatsapp", "social"] },
        subject: { type: "string" },
        body: { type: "string" },
        reason: { type: "string", description: "Why you're drafting instead of sending." },
      },
      required: ["leadId", "channel", "body"],
    },
  },
  {
    name: "move_stage",
    description: "Advance (or, with a reason, move back) a lead's pipeline item to a different stage.",
    input_schema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The pipeline item id shown for this lead." },
        toStageId: { type: "string", description: "One of the stage ids listed as available for this lead." },
        reason: { type: "string", description: "Required only when moving backward." },
      },
      required: ["itemId", "toStageId"],
    },
  },
  {
    name: "update_lead_fields",
    description: "Record qualifying signals extracted from the conversation directly onto the lead.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        budgetMentioned: { type: "boolean" },
        timelineMentioned: { type: "boolean" },
        decisionMakerConfirmed: { type: "boolean" },
        company: { type: "string" },
        title: { type: "string" },
      },
      required: ["leadId"],
    },
  },
];

async function runSendTool(
  orgId: string,
  input: { leadId: string; channel: Channel["name"]; subject?: string; body: string },
  accountId?: string,
  senderName?: string,
) {
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId } });
  if (!lead) return { ok: false, reason: "lead not found" };
  const rendered = renderMessage({ subject: input.subject, body: input.body }, lead, { senderName });
  const result = await safeSend(
    input.channel,
    { id: lead.id, email: lead.email, phone: lead.phone, linkedinUrl: lead.linkedinUrl, firstName: lead.firstName },
    rendered,
    accountId,
    orgId,
  );

  await prisma.message.create({
    data: {
      organizationId: orgId,
      leadId: lead.id,
      channel: input.channel,
      renderedSubject: rendered.subject,
      renderedBody: rendered.body,
      status: result.ok ? "sent" : result.skipped ? "queued" : "failed",
      providerId: result.providerId,
      idempotencyKey: randomUUID(),
      sentAt: result.ok ? new Date() : null,
    },
  });
  await logActivity({
    organizationId: orgId,
    leadId: lead.id,
    type: result.ok ? "sent" : "failed",
    channel: input.channel,
    meta: { reason: result.reason },
  });
  return result;
}

async function runDraftTool(
  orgId: string,
  input: { leadId: string; channel: Channel["name"]; subject?: string; body: string; reason?: string },
  senderName?: string,
) {
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId } });
  if (!lead) return { ok: false, reason: "lead not found" };
  const rendered = renderMessage({ subject: input.subject, body: input.body }, lead, { senderName });

  const message = await prisma.message.create({
    data: {
      organizationId: orgId,
      leadId: lead.id,
      channel: input.channel,
      renderedSubject: rendered.subject,
      renderedBody: rendered.body,
      status: "draft",
      idempotencyKey: randomUUID(),
    },
  });
  return { ok: true, drafted: true, messageId: message.id, reason: input.reason };
}

async function runMoveStageTool(orgId: string, input: { itemId: string; toStageId: string; reason?: string }) {
  try {
    const updated = await moveToStage({
      organizationId: orgId,
      itemId: input.itemId,
      toStageId: input.toStageId,
      reason: input.reason,
      actorKind: "ai",
    });
    return { ok: true, itemId: updated.id, stageId: updated.stageId };
  } catch (e) {
    if (e instanceof BackwardMoveNeedsReason) return { ok: false, reason: e.message };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function runUpdateLeadFieldsTool(
  orgId: string,
  input: {
    leadId: string;
    budgetMentioned?: boolean;
    timelineMentioned?: boolean;
    decisionMakerConfirmed?: boolean;
    company?: string;
    title?: string;
  },
) {
  const { leadId, ...fields } = input;
  const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(data).length === 0) return { ok: false, reason: "no fields given" };

  const res = await prisma.lead.updateMany({ where: { id: leadId, organizationId: orgId }, data });
  if (res.count === 0) return { ok: false, reason: "lead not found" };
  const score = await recomputeAndSaveLeadScore(leadId, orgId);
  return { ok: true, score };
}

/** Per-lead context: identity, current pipeline position + valid move targets, recent
 *  conversation history. This is what makes move_stage/update_lead_fields usable — the
 *  model needs real stage ids and real prior messages to reason from, not just a name. */
async function buildLeadContext(orgId: string, leadIds: string[]): Promise<string> {
  const [leads, items, events] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leadIds }, organizationId: orgId } }),
    prisma.pipelineItem.findMany({
      where: { organizationId: orgId, leadId: { in: leadIds } },
      include: { stage: true, pipeline: { include: { stages: { orderBy: { position: "asc" } } } } },
    }),
    prisma.conversationEvent.findMany({
      where: { organizationId: orgId, leadId: { in: leadIds } },
      orderBy: { occurredAt: "desc" },
      take: 500,
    }),
  ]);

  const itemByLead = new Map(items.map((i) => [i.leadId, i]));
  const eventsByLead = new Map<string, typeof events>();
  for (const e of events) {
    const arr = eventsByLead.get(e.leadId) ?? [];
    if (arr.length < 5) arr.push(e);
    eventsByLead.set(e.leadId, arr);
  }

  return leads
    .map((l) => {
      const item = itemByLead.get(l.id);
      const recent = (eventsByLead.get(l.id) ?? []).slice().reverse();
      const history = recent.length
        ? recent.map((e) => `    [${e.direction} ${e.channel}] ${(e.body ?? e.subject ?? "").slice(0, 140)}`).join("\n")
        : "    (no prior conversation)";
      const stageInfo = item
        ? `  Pipeline item: ${item.id} — currently in "${item.stage.name}" (${item.pipeline.name})\n` +
          `  Stages you may move it to: ${item.pipeline.stages.map((s) => `${s.name} [${s.id}]`).join(", ")}`
        : "  Not yet in a pipeline (move_stage isn't usable for this lead).";
      return (
        `- ${l.id}: ${[l.firstName, l.lastName].filter(Boolean).join(" ") || "(no name)"} <${l.email ?? "no-email"}>` +
        `${l.phone ? ` phone:${l.phone}` : ""} @ ${l.company ?? "?"}\n${stageInfo}\n` +
        `  Known signals: budget=${l.budgetMentioned ?? "unknown"}, timeline=${l.timelineMentioned ?? "unknown"}, ` +
        `decisionMaker=${l.decisionMakerConfirmed ?? "unknown"}, score=${l.score ?? "unscored"}\n` +
        `  Recent conversation (oldest first):\n${history}`
      );
    })
    .join("\n\n");
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  steps: number;
}

/** Run the agent over a set of leads with a campaign brief. */
export async function runAgent(opts: {
  orgId: string;
  userId?: string;
  leadIds: string[];
  brief: string;
  maxSteps?: number;
  sendingAccountId?: string;
  /** 0-1, how sure the model should be before it sends unattended vs. drafting. Default 0.7. */
  confidenceThreshold?: number;
}): Promise<AgentRunResult> {
  if (!configured.anthropic) {
    return { ok: false, summary: "ANTHROPIC_API_KEY not set", steps: 0 };
  }

  // Same priority as the job processor (lib/job-processor.ts): the sending account's
  // identity, if one was picked for this run, wins over the individual user's — so an
  // agent sending as "Support Desk" doesn't sign its LinkedIn/email copy as someone else.
  const senderName =
    (await senderNameForAccount(opts.sendingAccountId)) ||
    (await senderNameForUser(opts.userId)) ||
    (await senderNameForCampaign(undefined, opts.orgId));
  const threshold = Math.min(1, Math.max(0, opts.confidenceThreshold ?? 0.7));

  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const llm = provider();
  // Fail fast rather than hang past Vercel's function limit — 60s + one retry turns a
  // stuck call into a clear, catchable error instead of an opaque 500.
  const client = new AnthropicSDK({
    apiKey: llm.apiKey,
    ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
    timeout: 60_000,
    maxRetries: 1,
  });

  // Email availability is a per-workspace fact, not a platform one: mail goes out
  // through a SendingAccount this org connected, so the env SMTP flag says nothing
  // about whether THIS org can send. Checking the org's accounts is the difference
  // between the agent using a connected Gmail and refusing to email at all.
  const emailAccountId = opts.sendingAccountId ?? (await defaultSendingAccountId(opts.orgId));

  // social has no working adapter yet (lib/channels/social.ts is a stub — isConfigured()
  // always returns false), so it's deliberately never offered here.
  const availableChannels = [
    emailAccountId && "email",
    configured.whatsapp && "whatsapp",
    "linkedin (human-assisted — see rules)",
  ]
    .filter(Boolean)
    .join(", ");

  const leadContext = await buildLeadContext(opts.orgId, opts.leadIds);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Campaign brief:\n${opts.brief}\n\nLeads:\n${leadContext}\n\nTake the appropriate action for each lead now.`,
    },
  ];

  const maxSteps = opts.maxSteps ?? 20;
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    const resp = await client.messages.create({
      ...routingExtras(llm),
      model: llm.model,
      max_tokens: 2048,
      system: systemPrompt(threshold, availableChannels),
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: resp.content });

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "done";
      return { ok: true, summary: text, steps };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = use.input as any;
      let out: unknown;
      try {
        switch (use.name) {
          case "send_message":
            out = await runSendTool(opts.orgId, input, emailAccountId ?? undefined, senderName);
            break;
          case "draft_message":
            out = await runDraftTool(opts.orgId, input, senderName);
            break;
          case "move_stage":
            out = await runMoveStageTool(opts.orgId, input);
            break;
          case "update_lead_fields":
            out = await runUpdateLeadFieldsTool(opts.orgId, input);
            break;
          default:
            out = { ok: false, reason: `unknown tool ${use.name}` };
        }
      } catch (e) {
        out = { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: toolResults });

    if (resp.stop_reason !== "tool_use") {
      const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "done";
      return { ok: true, summary: text, steps: steps + 1 };
    }
  }

  return { ok: true, summary: "max steps reached", steps };
}

/**
 * The model provider for both the tool loop and the reply classifier.
 *
 * OpenRouter is preferred when its key is present: its Anthropic-compatible
 * endpoint speaks the same Messages API, so one SDK and one wire format serve
 * both providers. Falling back to Anthropic direct keeps existing deployments
 * working without an env change.
 *
 * `fallbackModels` is OpenRouter's own routing, passed through as `models` —
 * that is deliberately the only failover here. A second provider integration
 * would mean a second agent loop in a different wire format, with weaker tool
 * adherence exactly when it kicked in.
 */
function provider() {
  const useOpenRouter = !!env.openrouter.apiKey;
  return {
    name: useOpenRouter ? "openrouter" : "anthropic",
    apiKey: (useOpenRouter ? env.openrouter.apiKey : env.anthropic.apiKey)!,
    baseURL: useOpenRouter ? env.openrouter.baseUrl : undefined,
    model: useOpenRouter ? env.openrouter.model : env.anthropic.model,
    classifierModel: useOpenRouter ? env.openrouter.classifierModel : env.anthropic.classifierModel,
    fallbackModels: useOpenRouter ? env.openrouter.fallbackModels : [],
  };
}

/**
 * OpenRouter accepts a `models` array for automatic failover. It is not part of
 * the Anthropic Messages schema, so it is attached as an extra body field and
 * omitted entirely when talking to Anthropic direct.
 */
function routingExtras(p: ReturnType<typeof provider>): Record<string, unknown> {
  return p.fallbackModels.length ? { models: [p.model, ...p.fallbackModels] } : {};
}

const INTENTS = ["interested", "objection", "ooo", "wrong_person", "unsubscribe", "other"] as const;
export type ReplyIntent = (typeof INTENTS)[number];

/**
 * Classifies one inbound reply's intent on the small/cheap model — this runs on every
 * reply (lib/inbox/store.ts, lib/ingest.ts), not just inside a campaign run, so it's
 * deliberately separate from the main tool-calling loop above.
 */
export async function classifyReplyIntent(text: string): Promise<ReplyIntent | null> {
  if (!configured.anthropic || !text.trim()) return null;
  try {
    const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
    const llm = provider();
    const client = new AnthropicSDK({
      apiKey: llm.apiKey,
      ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
      timeout: 20_000,
      maxRetries: 1,
    });
    const resp = await client.messages.create({
      model: llm.classifierModel,
      max_tokens: 10,
      system:
        `Classify the intent of this email/message reply as exactly one of: ${INTENTS.join(", ")}. ` +
        `Respond with only that one word, nothing else.`,
      messages: [{ role: "user", content: text.slice(0, 2000) }],
    });
    const word = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text?.trim().toLowerCase();
    return (INTENTS as readonly string[]).includes(word ?? "") ? (word as ReplyIntent) : null;
  } catch (e) {
    console.error("[agent] classifyReplyIntent failed:", e);
    return null;
  }
}
