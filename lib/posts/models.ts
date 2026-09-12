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
export const POST_MODELS: PostModel[] = [
  { id: "minimax/minimax-m2", label: "MiniMax M2", tier: "standard", creditAction: "ai_post_standard" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", tier: "standard", creditAction: "ai_post_standard" },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", tier: "premium", creditAction: "ai_post_premium" },
  { id: "openai/gpt-5.2", label: "GPT-5.2", tier: "premium", creditAction: "ai_post_premium" },
];

export const modelById = (id: string) => POST_MODELS.find((m) => m.id === id) ?? null;

export const DEFAULT_MODEL = POST_MODELS[0].id;
