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
  /** In the profile's own top card — the action row, not a "see more" elsewhere. */
  inTopCard?: boolean;
  /** Nearest heading above it, so identical labels can be told apart. */
  section?: string | null;
  y?: number;
}

export interface PilotObservation {
  goal: "invite" | "message";
  /** The profile owner, from the page's <h1>. */
  personName: string;
  /** The note or message to send, already truncated by the caller. */
  note: string | null;
  /** True when the run is allowed to actually send. */
  autoSend: boolean;
  /**
   * Whether this invitation may carry a note.
   *
   * LinkedIn allows only a few personalised notes a day, so the client budgets
   * them and decides. The model is told the answer rather than asked for it —
   * it cannot know how many have been spent today, and guessing would burn the
   * allowance on whoever happened to come first.
   */
  useNote?: boolean;
  url: string;
  step: number;
  /** What has already been done this attempt, newest last. */
  history: string[];
  elements: PilotElement[];
  /** Base64 JPEG, sent only once the element list has not been enough. */
  screenshot?: string | null;
}

export type PilotDecision =
  /**
   * `label` is the words visible on the control, for the many LinkedIn controls
   * that are an unlabelled <span> and so cannot appear in the numbered list at
   * all. An index is preferred when one fits; `label` rescues a control the list
   * cannot describe.
   *
   * Deliberately not called `text`: on a `type` action `text` is what to type,
   * and one field meaning two things is how the note ends up in the button.
   */
  | { action: "click"; index?: number; label?: string; reason: string }
  | { action: "type"; index?: number; label?: string; text: string; reason: string }
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

LOOK AT THE SCREENSHOT FIRST. It is the truth about the page; the list below it
is a partial description. Many LinkedIn controls — Connect among them — are
unlabelled spans that cannot appear in the list at all, so a control being absent
from the list means nothing about whether it is on the page.

Reply with ONLY a JSON object, no prose, no code fence:
  {"action":"click","index":<n>,"reason":"<short>"}
  {"action":"click","label":"<exact words on the control>","reason":"<short>"}
  {"action":"type","index":<n>,"text":"<text>","reason":"<short>"}
  {"action":"done","reason":"<short>"}
  {"action":"give_up","reason":"<short>"}

Use an index when the control you want is clearly in the list. When you can SEE a
control in the screenshot that is not in the list — this is common — answer with
"label" set to its exact visible words, e.g. {"action":"click","label":"Connect"}.
Never invent an index for something that is not listed.

Rules that matter more than completing the task:

- NEVER choose an element whose label names a person other than the profile owner. The page shows "People also viewed" and "More profiles for you", each with their own Connect buttons. Inviting the wrong person cannot be undone.
- NEVER choose: Remove Connection, Unfollow, Report, Block, Withdraw, Delete, Unsubscribe, or anything else destructive or irreversible.
- If the goal is an invitation and the person is ALREADY a connection, answer give_up with reason "already connected". Do not message them instead. There are exactly two pieces of evidence for that: a **1st**-degree badge next to their name, or a "Remove Connection" option. Nothing else counts.

  **2nd and 3rd degree mean they are NOT connected to you.** They are precisely the people worth inviting. Never treat "2nd" as already connected.

  The absence of a Connect button is NOT evidence of a connection either. On many profiles Connect simply is not on the card — it is inside the overflow menu, and you have not looked yet.

- Before you may answer give_up for want of a Connect button, you MUST have opened the profile's own "More" / "More actions" menu and read what appeared. If your history does not show that you opened it, open it now instead of giving up.
- If you cannot find a way to do the goal, answer give_up. A wrong click is far worse than stopping.

A page has SEVERAL buttons labelled "More". Only the one marked
IN-PROFILE-ACTION-ROW opens the profile's overflow menu; the others expand an
About or Experience section and contain nothing useful. Always prefer the one in
the action row.

If a click revealed nothing — the element list came back the same — you picked
the wrong one. Try a different candidate before giving up. Do not answer give_up
merely because the first menu you opened had no Connect in it.

Connect appears in one of two places, and you must check them in this order:

  a) ON THE PROFILE'S ACTION ROW, beside Message and More. Its label is
     "Connect", or "Invite <name> to connect". Click it — do NOT open a menu
     first.

     "Follow <name>" is NOT Connect. It appears in the same place on profiles
     that have no Connect on the card, and clicking it follows the person
     instead of asking to connect. Never choose it. If the only options are
     Follow and More, the Connect you want is inside More.
  b) INSIDE THE OVERFLOW MENU, only when there is no Connect on the action row.
     Open the "More" / "More actions", then look again in the list that follows.

IN-PROFILE-ACTION-ROW is a HINT, not a requirement. It is derived from the page
structure and is often absent even when the element is exactly the one you want.
NEVER refuse to act, and never answer give_up, merely because a Connect element
lacks that marker. If you can see a Connect for this profile — in the list, or in
the screenshot — click it. The marker only helps you choose between two
candidates that are otherwise identical.

Opening a menu when Connect was already on the card wastes a step and leaves the
menu covering the page.

How the task normally goes:
1. Click Connect, per (a) then (b) above.
2. A dialog opens asking whether to add a note. It usually offers "Add a note"
   and "Send without a note". Which one you take is NOT your decision — the
   prompt states "Add a note: yes" or "Add a note: no" and you must follow it:
     - no  → click "Send without a note". Do not open the note editor.
     - yes → click "Add a note", then type the note into the textarea, then send.
3. If sending is permitted, click "Send" / "Send now" / "Send invitation". If it
   is not permitted, answer done once the dialog is filled — a human will send it.
4. Once the dialog has closed and the invitation is away, answer done.

An invitation without a note is still an invitation. Never answer give_up because
no note could be added.

Answer done only when the goal is actually achieved. Answer give_up rather than guessing.

Only ever use an index that appears in the list. Do not answer -1 or any other
number that is not listed — if what you need is not there, answer give_up and say
so, and you will be shown a screenshot of the page instead.`;

function userPrompt(o: PilotObservation): string {
  const lines = o.elements.map(
    (e) =>
      `${e.i}. <${e.tag}${e.role ? ` role=${e.role}` : ""}${e.disabled ? " disabled" : ""}${
        e.inDialog ? " in-dialog" : ""
      }${e.inTopCard ? " IN-PROFILE-ACTION-ROW" : ""}${e.inAside ? " IN-SIDEBAR-DO-NOT-USE" : ""}> ${e.label}` +
      (e.section ? `   [under: ${e.section}]` : ""),
  );

  return [
    `Goal: ${o.goal === "invite" ? "send a connection request" : "send a direct message"}`,
    `Profile owner: ${o.personName || "(unknown)"}`,
    `URL: ${o.url}`,
    `Note to include: ${o.note ? JSON.stringify(o.note) : "(none)"}`,
    `Allowed to actually send: ${o.autoSend ? "yes" : "no — stop once the text is entered"}`,
    `Add a note: ${o.useNote ? "yes" : 'no — click "Send without a note"'}`,
    `Step ${o.step}.`,
    o.history.length ? `Already done:\n${o.history.map((h) => `  - ${h}`).join("\n")}` : "Nothing done yet.",
    "",
    "Clickable elements:",
    ...(lines.length ? lines : ["  (none found)"]),
    o.screenshot
      ? "\nA screenshot of the page is attached. Use it to work out WHICH numbered element above is the one you want — labels alone cannot tell you that a button is the prominent one on the profile card. Answer with an index from the list; the picture is for identifying it, not for describing coordinates. If you can see Connect in the picture, one of the listed elements is it."
      : "",
  ].join("\n");
}

/**
 * Pull the decision out, tolerating a model that wrapped it in prose or a fence.
 *
 * `valid` is the set of indices the page actually offered. Models answer -1 to
 * mean "not in this list", and that sailed through as a number, reached the
 * page, matched nothing, and was counted as a refused suggestion — three of them
 * ended the action. An index that does not exist is not a click; it is the model
 * saying it cannot see what it needs, which is what the screenshot is for.
 */
function parseDecision(text: string, valid?: Set<number>): PilotDecision {
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
  if (a === "click" || a === "type") {
    const idx = (parsed as { index?: unknown }).index;
    const lbl = (parsed as { label?: unknown }).label;
    const hasLabel = typeof lbl === "string" && lbl.trim().length > 0 && lbl.length <= 80;
    if (typeof idx !== "number" && !hasLabel) throw new Error(`${a} without an index or a label`);
    // A label is resolved on the page by its visible words, so an index is
    // optional once one is given.
    if (typeof idx === "number" && valid && !valid.has(idx) && !hasLabel) {
      // Not a malformed reply — a considered "it is not in the list". Turned
      // into a give_up so the caller escalates to a screenshot rather than
      // firing a click at an element that was never there.
      return {
        action: "give_up",
        reason: `chose index ${idx}, which is not on the page — the element list does not describe what is needed`,
      };
    }
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

  return parseDecision(text, new Set(o.elements.map((e) => e.i)));
}
