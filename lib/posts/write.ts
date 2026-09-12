/**
 * Writing a LinkedIn post: a topic (or a bare brief), a curated model, N
 * variants — each one a Post row, each one paid for.
 *
 * Credits are reserved per variant before the model is called and settled
 * once it's written, the same shape as everything else in
 * lib/billing/meter.ts: nobody pays for a call that failed, and a model that
 * comes back empty is a release, not a charge.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";
import { charge, keepCredits, returnCredits } from "../billing/meter";
import { billingEnforced } from "../billing/limits";
import { modelById, type PostModel } from "./models";
import type { TopicCard } from "./research";

const MAX_CHARS = 3000; // LinkedIn's own ceiling on a feed post

export interface WriteInput {
  organizationId: string;
  userId: string;
  model: PostModel;
  brief?: string | null;
  topic?: TopicCard | null;
  variants: number;
  autopilotId?: string | null;
  runId?: string | null;
}

function systemPrompt(): string {
  return `You write LinkedIn posts for a real person's own profile. Rules:
- Plain text only — no markdown headers, no bullet asterisks LinkedIn won't render, hashtags are fine.
- Under ${MAX_CHARS} characters, ideally 800-1500.
- No invented statistics, quotes, or claims you cannot support from the topic given.
- Sound like a person who actually has a view, not a press release. Concrete beats generic.
- Output ONLY the post text — no preamble, no "Here's a post:", no surrounding quotes.`;
}

function userPrompt(input: WriteInput): string {
  const parts: string[] = [];
  if (input.topic) {
    parts.push(`Topic: ${input.topic.topic}\nAngle: ${input.topic.why}`);
    if (input.topic.sources.length) parts.push(`Sources:\n${input.topic.sources.map((s) => `- ${s.title} (${s.url})`).join("\n")}`);
  }
  if (input.brief) parts.push(`Brief / tone: ${input.brief}`);
  if (!parts.length) parts.push("Write a general, engaging professional post — no specific topic was given.");
  return parts.join("\n\n");
}

async function callModel(model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${env.openrouter.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openrouter.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1200,
      temperature: 0.8,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter answered ${res.status} for model "${model}"`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The model returned no text.");
  return text.slice(0, MAX_CHARS);
}

export interface WrittenPost {
  postId: string;
  body: string;
}

/**
 * Write `variants` drafts, each charged and each a Post row in `draft` or
 * `needs_review` status (the caller decides which — a manual write is a
 * draft; an autopilot's review-mode run marks its own).
 */
export async function writePosts(
  input: WriteInput,
  status: "draft" | "needs_review" | "scheduled" = "draft",
): Promise<{ posts: WrittenPost[]; failed: number }> {
  if (!env.openrouter.apiKey) throw new Error("No OpenRouter key configured — AI writing isn't available on this deployment.");
  const system = systemPrompt();
  const user = userPrompt(input);
  const posts: WrittenPost[] = [];
  let failed = 0;

  for (let i = 0; i < input.variants; i++) {
    const ref = { type: "post_write", id: randomUUID() };
    const paid = billingEnforced()
      ? await charge(input.organizationId, input.model.creditAction, { ref, meta: { autopilotId: input.autopilotId ?? null } })
      : { ok: true as const, ref, cost: 0 };
    if (!paid.ok) {
      failed++;
      continue; // out of credits — stop trying more variants silently costs nothing further
    }
    try {
      const body = await callModel(input.model.id, system, user);
      const post = await prisma.post.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          status,
          body,
          model: input.model.id,
          topic: (input.topic ?? undefined) as object | undefined,
          autopilotId: input.autopilotId ?? null,
          runId: input.runId ?? null,
          creditsCharged: paid.ok ? paid.cost : 0,
        },
      });
      if (billingEnforced()) await keepCredits(input.organizationId, paid.ref);
      posts.push({ postId: post.id, body });
    } catch (e) {
      console.error("[posts/write] a variant failed to write:", e);
      if (billingEnforced()) await returnCredits(input.organizationId, paid.ref, "the model call failed");
      failed++;
    }
  }

  return { posts, failed };
}

/** Look up and validate a model id against the curated list, or say why not. */
export function requireModel(id: string): PostModel {
  const model = modelById(id);
  if (!model) throw new Error(`"${id}" isn't one of the models on offer.`);
  return model;
}
