/**
 * The pilot: a model decides what to click on a LinkedIn profile.
 *
 * Selectors lost. LinkedIn moves Connect onto the card, into an overflow menu,
 * behind a "Follow" primary, and renames its labels, and each move cost a
 * release. This asks a model to look at what is actually on the page and choose
 * the next action instead.
 *
 * Two things make that safe enough to do at all:
 *
 *   1. **The model picks an index, never a selector.** It chooses from a list of
 *      elements the page itself reported, so it cannot invent a target that is
 *      not there or describe one ambiguously.
 *   2. **The client vetoes.** Whatever comes back is re-checked on the desktop
 *      side against the person's name and a list of destructive labels before
 *      anything is clicked. A model that is wrong should cost a failed action,
 *      never an invitation to a stranger or a "Remove connection".
 *
 * The key lives here rather than in the app: the desktop client authenticates
 * with a pairing token that is worth far less than an LLM key, and shipping a
 * provider key inside a downloadable binary hands it to anyone who unzips it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env, configured } from "../env";

/** One clickable the page reported. `i` is what the model answers with. */
export interface PilotElement {
  i: number;
  tag: string;
  role?: string | null;
  label: string;
  disabled?: boolean;
  inDialog?: boolean;
  inAside?: boolean;
}

export interface PilotObservation {
  goal: "invite" | "message";
  /** The profile owner, from the page's <h1>. */
  personName: string;
  /** The note or message to send, already truncated by the caller. */
  note: string | null;
  /** True when the run is allowed to actually send. */
  autoSend: boolean;
  url: string;
  step: number;
  /** What has already been done this attempt, newest last. */
  history: string[];
  elements: PilotElement[];
  /** Base64 JPEG, sent only once the element list has not been enough. */
  screenshot?: string | null;
}

export type PilotDecision =
  | { action: "click"; index: number; reason: string }
  | { action: "type"; index: number; text: string; reason: string }
  | { action: "done"; reason: string }
  | { action: "give_up"; reason: string };

export const pilotAvailable = () => configured.agent;

function provider() {
  const useOpenRouter = !!env.openrouter.apiKey;
  return {
    apiKey: (useOpenRouter ? env.openrouter.apiKey : env.anthropic.apiKey)!,
    baseURL: useOpenRouter ? env.openrouter.baseUrl : undefined,
    model: useOpenRouter ? env.openrouter.pilotModel : env.anthropic.model,
    fallbackModels: useOpenRouter ? env.openrouter.fallbackModels : [],
  };
}

const SYSTEM = `You are operating one LinkedIn profile page on behalf of its owner, through a browser.

You will be given the profile owner's name and a numbered list of every clickable element on the page, with its accessible label. Choose ONE next action.

Reply with ONLY a JSON object, no prose, no code fence:
  {"action":"click","index":<n>,"reason":"<short>"}
  {"action":"type","index":<n>,"text":"<text>","reason":"<short>"}
  {"action":"done","reason":"<short>"}
  {"action":"give_up","reason":"<short>"}

Rules that matter more than completing the task:

- NEVER choose an element whose label names a person other than the profile owner. The page shows "People also viewed" and "More profiles for you", each with their own Connect buttons. Inviting the wrong person cannot be undone.
- NEVER choose: Remove Connection, Unfollow, Report, Block, Withdraw, Delete, Unsubscribe, or anything else destructive or irreversible.
- If the goal is an invitation and the person is ALREADY a connection (a 1st-degree badge, a "Remove Connection" option, or no Connect anywhere), answer give_up with reason "already connected". Do not message them instead.
- If you cannot find a way to do the goal, answer give_up. A wrong click is far worse than stopping.

How the task normally goes:
1. Click Connect. It may be on the card, or behind a "More actions" / "…" overflow menu — open that menu first if you do not see Connect.
2. A dialog opens. If a note is provided, click "Add a note", then type it into the textarea.
3. If sending is permitted, click "Send" / "Send now" / "Send invitation". If it is not permitted, answer done once the note is typed — a human will send it.
4. Once the dialog has closed and the invitation is away, answer done.

Answer done only when the goal is actually achieved. Answer give_up rather than guessing.`;

function userPrompt(o: PilotObservation): string {
  const lines = o.elements.map(
    (e) =>
      `${e.i}. <${e.tag}${e.role ? ` role=${e.role}` : ""}${e.disabled ? " disabled" : ""}${
        e.inDialog ? " in-dialog" : ""
      }${e.inAside ? " IN-SIDEBAR-DO-NOT-USE" : ""}> ${e.label}`,
  );

  return [
    `Goal: ${o.goal === "invite" ? "send a connection request" : "send a direct message"}`,
    `Profile owner: ${o.personName || "(unknown)"}`,
    `URL: ${o.url}`,
    `Note to include: ${o.note ? JSON.stringify(o.note) : "(none)"}`,
    `Allowed to actually send: ${o.autoSend ? "yes" : "no — stop once the text is entered"}`,
    `Step ${o.step}.`,
    o.history.length ? `Already done:\n${o.history.map((h) => `  - ${h}`).join("\n")}` : "Nothing done yet.",
    "",
    "Clickable elements:",
    ...(lines.length ? lines : ["  (none found)"]),
    o.screenshot ? "\nA screenshot is attached because the element list has not been enough." : "",
  ].join("\n");
}

/** Pull the decision out, tolerating a model that wrapped it in prose or a fence. */
function parseDecision(text: string): PilotDecision {
  const cleaned = text.replace(/```json?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`no JSON in model reply: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as PilotDecision;

  if (!parsed || typeof parsed !== "object") throw new Error("decision is not an object");
  const a = (parsed as { action?: unknown }).action;
  if (a !== "click" && a !== "type" && a !== "done" && a !== "give_up") {
    throw new Error(`unknown action ${String(a)}`);
  }
  if ((a === "click" || a === "type") && typeof (parsed as { index?: unknown }).index !== "number") {
    throw new Error(`${a} without an index`);
  }
  return parsed;
}

/**
 * Ask for the next action.
 *
 * Deliberately one decision per call rather than a tool-use loop: the page
 * changes under us after every click, so the only honest input is a fresh
 * observation, and a stateless call is far easier to reason about when it goes
 * wrong on somebody's real account.
 */
export async function decideNextAction(o: PilotObservation): Promise<PilotDecision> {
  if (!pilotAvailable()) throw new Error("No model is configured (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY).");
  const p = provider();

  const client = new Anthropic({ apiKey: p.apiKey, ...(p.baseURL ? { baseURL: p.baseURL } : {}) });

  const content: Anthropic.MessageParam["content"] = [{ type: "text", text: userPrompt(o) }];
  if (o.screenshot) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: o.screenshot },
    });
  }

  const res = await client.messages.create(
    {
      model: p.model,
      max_tokens: 400,
      // The decision is a handful of tokens; the cost here is the page, not the
      // reply, so there is no reason to let it ramble.
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      ...(p.fallbackModels.length ? ({ models: [p.model, ...p.fallbackModels] } as object) : {}),
    },
    { timeout: 45_000 },
  );

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return parseDecision(text);
}
