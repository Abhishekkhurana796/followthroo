/**
 * The curated model list for AI-written posts.
 *
 * Deliberately not "type any OpenRouter model id": every model shown here has
 * a fixed credit cost printed beside it (lib/billing/plans.ts CREDIT_COSTS —
 * standard or premium), and that promise only holds if the id charged is one
 * of these. `lib/posts/write.ts` refuses anything else.
 */
import type { CreditAction } from "../billing/plans";

export type ModelTier = "standard" | "premium";

export interface PostModel {
  id: string; // OpenRouter model id, e.g. "minimax/minimax-m2"
  label: string;
  tier: ModelTier;
  /** Which CREDIT_COSTS key a post written with this model charges. */
  creditAction: CreditAction;
}

/**
 * Two tiers, a small list. Premium is Grow-and-above (plans.ts
 * "premium_ai_models"); Standard is available on every paid plan.
 *
 * These are checked against OpenRouter at startup-adjacent points (an autopilot
 * save, a manual write) rather than trusted blindly — an id OpenRouter has
 * quietly retired is exactly the kind of thing that fails silently otherwise
 * (see env.ts's own note about a stale default model).
 */
/**
 * Two substitutions from what was asked for, because the exact id doesn't
 * exist on OpenRouter's catalog (checked 2026-09-13):
 *  - "Qwen2.5 14B" → `qwen/qwen3-14b`, the closest same-size-class model in
 *    the current generation. Qwen2.5 has no 14B variant listed.
 *  - "GLM 5.3 Max" → `z-ai/glm-5.3`, the flagship of the 5.3 line. There is no
 *    "-max" variant; `-flash` is the only other one, and it's the cheaper one.
 *
 * Tiers are cost-based, checked against OpenRouter's own per-token pricing at
 * the same date, not the source names above: Fable prices about 2x Opus 5, so
 * it gets its own `ai_post_fable` action rather than sharing `ai_post_premium`.
 * Priced at 39 credits (see plans.ts) to clear a ~$0.085 floor even at Scale's
 * $0.0022/credit — the cheapest rate any plan pays per credit, and so the one
 * a single global price has to cover. Everything else fits its existing
 * standard/premium action with real margin to spare.
 */
export const POST_MODELS: PostModel[] = [
  { id: "minimax/minimax-m2", label: "MiniMax M2", tier: "standard", creditAction: "ai_post_standard" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", tier: "standard", creditAction: "ai_post_standard" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", tier: "standard", creditAction: "ai_post_standard" },
  { id: "qwen/qwen3-14b", label: "Qwen3 14B", tier: "standard", creditAction: "ai_post_standard" },
  { id: "qwen/qwen3-235b-a22b-2507", label: "Qwen3 235B A22B", tier: "standard", creditAction: "ai_post_standard" },
  { id: "z-ai/glm-5.3", label: "GLM 5.3", tier: "standard", creditAction: "ai_post_standard" },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", tier: "premium", creditAction: "ai_post_premium" },
  { id: "openai/gpt-5.2", label: "GPT-5.2", tier: "premium", creditAction: "ai_post_premium" },
  { id: "openai/gpt-5.5", label: "GPT-5.5", tier: "premium", creditAction: "ai_post_premium" },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", tier: "premium", creditAction: "ai_post_premium" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", tier: "premium", creditAction: "ai_post_premium" },
  { id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1", tier: "premium", creditAction: "ai_post_fable" },
];

export const modelById = (id: string) => POST_MODELS.find((m) => m.id === id) ?? null;

export const DEFAULT_MODEL = POST_MODELS[0].id;
