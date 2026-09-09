/**
 * The connection-note ceiling, in one place.
 *
 * LinkedIn caps a connection request's note at 300 characters. A message has no
 * such limit worth worrying about (~8k), so this applies to invites only — which
 * is why it lives here rather than on the template.
 */

/** LinkedIn's hard ceiling on an invite note. See docs/phantombuster.md #18. */
export const INVITE_NOTE_MAX = 300;

/** Where a counter should turn amber, leaving room for a long company name. */
export const INVITE_NOTE_WARN = 250;

/**
 * Longest the note could plausibly render to.
 *
 * A template is authored with `{{firstName}}` placeholders, so its literal
 * length says nothing about what actually goes out — and a note that only fits
 * when every variable happens to be empty is a note that fails in production, on
 * the one lead whose company is "International Business Machines Corporation".
 *
 * So each token is priced at a deliberately generous stand-in rather than at
 * zero. Estimated on purpose: this is the build-time guard, and
 * `lib/channels/linkedin.ts` still measures the real string at send time.
 */
const TOKEN_BUDGET: Record<string, number> = {
  firstName: 12,
  lastName: 14,
  fullName: 26,
  company: 30,
  title: 40,
  headline: 60,
  location: 28,
};

/** Anything not named above still has to be worth something. */
const DEFAULT_TOKEN_BUDGET = 20;

export function worstCaseNoteLength(body: string): number {
  if (!body) return 0;
  let total = 0;
  let lastIndex = 0;
  const token = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;

  while ((m = token.exec(body)) !== null) {
    total += m.index - lastIndex;
    const name = m[1].split(".").pop() ?? "";
    total += TOKEN_BUDGET[name] ?? DEFAULT_TOKEN_BUDGET;
    lastIndex = m.index + m[0].length;
  }
  total += body.length - lastIndex;
  return total;
}
