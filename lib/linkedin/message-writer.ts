/**
 * AI-written LinkedIn messages: one short, personal message per lead, written
 * from what the CRM already holds about them and saved on the lead, where a
 * campaign's LinkedIn message step picks it up (lib/channels/linkedin.ts).
 *
 * Writing and sending are deliberately separate. Nothing here queues or sends
 * anything — a message is generated, reviewed, edited if needed, and only goes
 * out when a campaign reaches its message step.
 *
 * The model sees only facts that are actually on the record, each labelled, and
 * is told those are all it knows. A message that invents a shared event or an
 * achievement is worse than a plain one: it is the kind of thing a recipient
 * notices, and it goes out under a real person's name.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";
import { charge, keepCredits, returnCredits } from "../billing/meter";
import { LINKEDIN_MESSAGE_MAX } from "./note";

export type LeadFacts = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  tags: string[];
  /** Extra CSV columns. Descriptive ones help; identifying ones are dropped. */
  custom: Record<string, unknown>;
  /** Newest first. */
  notes: string[];
  connectedSince: string | null;
};

/** Custom columns that reach or identify the person rather than describe them. */
const PRIVATE_KEY = /e-?mail|phone|mobile|whatsapp|address|password|token|secret|\bid\b|_id$|url|link/i;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The record as the model sees it: present facts only, one labelled line each. */
export function leadFactsText(f: LeadFacts): string {
  const lines: string[] = [];
  const name = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  if (name) lines.push(`Name: ${name}`);
  if (f.title?.trim()) lines.push(`Job title: ${f.title.trim()}`);
  if (f.company?.trim()) lines.push(`Company: ${f.company.trim()}`);
  if (f.connectedSince?.trim()) lines.push(`Connected on LinkedIn since: ${f.connectedSince.trim()}`);
  const tags = (f.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length) lines.push(`Tags: ${tags.slice(0, 10).join(", ")}`);
  let customLines = 0;
  for (const [key, raw] of Object.entries(f.custom ?? {})) {
    if (customLines >= 15) break;
    if (PRIVATE_KEY.test(key)) continue;
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    const value = String(raw).trim();
    if (!value) continue;
    lines.push(`${clip(key.trim(), 40)}: ${clip(value, 120)}`);
    customLines++;
  }
  const notes = (f.notes ?? []).map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  if (notes.length) lines.push(`Notes from our team:\n${notes.map((n) => `- ${clip(n, 300)}`).join("\n")}`);
  return lines.join("\n");
}

export function messagePrompt(facts: string, senderName: string | null) {
  const system = [
    "You write one LinkedIn direct message from a real person to someone in their network.",
    "Rules:",
    "- 2 to 4 short sentences, under 450 characters. Plain text only.",
    "- Use ONLY the facts provided. Never invent achievements, news, shared history, mutual contacts, numbers or events. If little is known, stay general and honest rather than specific and made up.",
    "- Sound like a thoughtful person writing by hand: specific where the facts allow, warm and direct. Not salesy: no hype, no pitch, no pressure.",
    "- Open with their first name when you have it. End with one light question or easy reason to reply.",
    "- No subject line, no sign-off or signature, no emojis, no hashtags, no links, and no placeholders like [Company].",
    "- Output only the message itself.",
  ].join("\n");
  const user = `${senderName ? `Written by: ${senderName}\n\n` : ""}What we know about the recipient:\n${facts || "Nothing beyond their LinkedIn profile."}`;
  return { system, user };
}

/**
 * The model's reply as a message we would actually send, or null if it isn't
 * one. Reasoning models can wrap their thinking in the reply, and most models
 * occasionally add a preamble or quote marks; a leftover placeholder means the
 * model filled a template instead of writing, so that is refused outright.
 */
export function cleanMessage(raw: string): string | null {
  let text = String(raw ?? "").replace(/\r\n/g, "\n");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/^(here(?:'s| is)[^\n]*?:|sure[^\n]*?:|message:)\s*/i, "");
  text = text.replace(/^["“”']+|["“”']+$/g, "").trim();
  text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (/\[(first ?name|name|company|your name|job title|title)\]/i.test(text)) return null;
  if (text.length < 20) return null;
  if (text.length > LINKEDIN_MESSAGE_MAX) {
    const cut = text.slice(0, LINKEDIN_MESSAGE_MAX);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    text = (end > LINKEDIN_MESSAGE_MAX * 0.5 ? cut.slice(0, end + 1) : cut).trim();
  }
  return text;
}

async function writeWithModel(system: string, user: string): Promise<string> {
  const models = [env.openrouter.model, ...env.openrouter.fallbackModels.filter((m) => m !== env.openrouter.model)];
  const res = await fetch(`${env.openrouter.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openrouter.messagesApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: models[0],
      ...(models.length > 1 ? { models } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // Room for a reasoning model to think before it writes; the message itself
      // is capped by cleanMessage, not by the token budget.
      max_tokens: 1200,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`the AI service answered ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Carry a newly saved message into this lead's LinkedIn message actions that are
 * already queued but not yet picked up. A queued action holds its text from the
 * moment it was queued, so without this a message written after the campaign
 * reached the lead would never be the one sent — and the desktop app would go on
 * reporting the message as missing. Anything already claimed is left alone.
 */
export async function applyToQueuedMessages(organizationId: string, leadId: string, message: string) {
  await prisma.linkedInAction.updateMany({
    where: { organizationId, leadId, type: "message", status: "pending" },
    data: { note: message },
  });
}

export type MessageResult =
  | { leadId: string; status: "written"; message: string }
  | { leadId: string; status: "kept_edit"; message: string }
  | { leadId: string; status: "failed"; reason: string };

type LeadForWriting = Awaited<ReturnType<typeof loadLeads>>[number];

function loadLeads(organizationId: string, leadIds: string[]) {
  return prisma.lead.findMany({
    where: { organizationId, id: { in: leadIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      title: true,
      company: true,
      tags: true,
      custom: true,
      linkedinMessage: true,
      linkedinMessageSource: true,
      notes: { orderBy: { createdAt: "desc" }, take: 3, select: { body: true } },
      linkedInEnrichments: { where: { status: "done" }, orderBy: { completedAt: "desc" }, take: 1, select: { extra: true } },
    },
  });
}

/**
 * Write a message for each lead, three at a time. The caller has already
 * narrowed `leadIds` to leads the requester may change.
 *
 * A message somebody edited by hand is kept unless `overwriteEdited` is set —
 * only a deliberate single "Regenerate" sets it, never a bulk run.
 */
export async function generateLinkedInMessages(input: {
  organizationId: string;
  leadIds: string[];
  senderName: string | null;
  overwriteEdited?: boolean;
}): Promise<MessageResult[]> {
  if (!env.openrouter.messagesApiKey) {
    return input.leadIds.map((leadId) => ({
      leadId,
      status: "failed" as const,
      reason: "AI writing isn't set up on this deployment (no OpenRouter key).",
    }));
  }
  const leads = await loadLeads(input.organizationId, input.leadIds);
  const byId = new Map(leads.map((l) => [l.id, l]));
  const results: MessageResult[] = new Array(input.leadIds.length);
  let next = 0;
  const worker = async () => {
    while (next < input.leadIds.length) {
      const i = next++;
      results[i] = await writeOne(input, input.leadIds[i], byId.get(input.leadIds[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, input.leadIds.length) }, worker));
  return results;
}

async function writeOne(
  input: { organizationId: string; senderName: string | null; overwriteEdited?: boolean },
  leadId: string,
  lead: LeadForWriting | undefined,
): Promise<MessageResult> {
  if (!lead) return { leadId, status: "failed", reason: "not found" };
  if (lead.linkedinMessageSource === "edited" && lead.linkedinMessage && !input.overwriteEdited) {
    return { leadId, status: "kept_edit", message: lead.linkedinMessage };
  }

  const extra = (lead.linkedInEnrichments[0]?.extra ?? {}) as { connectedSince?: unknown };
  const facts = leadFactsText({
    firstName: lead.firstName,
    lastName: lead.lastName,
    title: lead.title,
    company: lead.company,
    tags: lead.tags,
    custom: (lead.custom ?? {}) as Record<string, unknown>,
    notes: lead.notes.map((n) => n.body),
    connectedSince: typeof extra.connectedSince === "string" ? extra.connectedSince : null,
  });
  const { system, user } = messagePrompt(facts, input.senderName);

  const paid = await charge(input.organizationId, "ai_linkedin_message", {
    ref: { type: "linkedin_message", id: randomUUID() },
    meta: { leadId },
  });
  if (!paid.ok) return { leadId, status: "failed", reason: paid.message };

  try {
    const message = cleanMessage(await writeWithModel(system, user));
    if (!message) throw new Error("the AI returned nothing usable");
    // Guarded again at write time: someone may have edited this lead's message
    // while the model was writing, and that edit wins over a bulk run.
    const saved = await prisma.lead.updateMany({
      where: {
        id: leadId,
        organizationId: input.organizationId,
        ...(input.overwriteEdited ? {} : { OR: [{ linkedinMessageSource: null }, { linkedinMessageSource: { not: "edited" } }] }),
      },
      data: { linkedinMessage: message, linkedinMessageSource: "ai", linkedinMessageUpdatedAt: new Date() },
    });
    if (saved.count === 0) {
      await returnCredits(input.organizationId, paid.ref, "kept a message edited meanwhile");
      const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { linkedinMessage: true } });
      return { leadId, status: "kept_edit", message: current?.linkedinMessage ?? "" };
    }
    await keepCredits(input.organizationId, paid.ref);
    await applyToQueuedMessages(input.organizationId, leadId, message);
    return { leadId, status: "written", message };
  } catch (e) {
    await returnCredits(input.organizationId, paid.ref, "the message could not be written");
    return { leadId, status: "failed", reason: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}
