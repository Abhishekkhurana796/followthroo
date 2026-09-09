/**
 * RFC-822 message-id handling — the difference between "this person emailed us"
 * and "this person replied to our campaign".
 *
 * Reply detection used to be a single string comparison: any inbound mail whose
 * From matched a Lead.email became a reply, moved the lead to the `replied`
 * stage, and stopped the sequence. Two things were wrong with that. A contact
 * sending an unrelated new enquiry ("can you send me your company profile?")
 * silently killed their sequence. And a genuine reply from an alias, an
 * assistant, or a forwarded thread was missed entirely, so the sequence kept
 * sending at somebody who had already answered.
 *
 * The fix is to thread on the headers every mail client already threads on. We
 * set our own Message-ID going out and store it; a real reply quotes it back in
 * In-Reply-To or References.
 */

/** Strip the angle brackets and normalize for comparison. */
export function normalizeMessageId(raw: string): string {
  return raw.trim().replace(/^</, "").replace(/>$/, "").trim().toLowerCase();
}

/**
 * Pull every message-id out of an In-Reply-To or References header.
 *
 * References is a whitespace-separated chain of the whole thread, and clients
 * vary in how much of it they keep — so we take all of them and match on any.
 * A mail deep in a long thread still names our original somewhere in that list,
 * which is what makes this work past the first exchange.
 */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return [];
  const bracketed = header.match(/<[^>]+>/g);
  const tokens = bracketed ?? header.split(/\s+/);
  return [...new Set(tokens.map(normalizeMessageId).filter(Boolean))];
}

/**
 * Build the Message-ID we put on an outbound mail.
 *
 * Derived from the Message row's own id so the two are the same fact — no
 * second column to keep in step, and a reply can be traced to its send without
 * a lookup table. The domain half must be a real domain we send from, or
 * receiving servers treat the header as suspect.
 */
export function buildRfcMessageId(messageId: string, domain: string): string {
  const clean =
    domain
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "")
      .trim() || "followthroo.com";
  return `<${messageId}@${clean}>`;
}

/** The domain half of an email address, for buildRfcMessageId. */
export function domainOfAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  return at === -1 ? null : address.slice(at + 1).trim().toLowerCase() || null;
}

/**
 * Pull one header out of a raw header blob, unfolding RFC-822 continuation
 * lines (any line starting with a space or tab belongs to the header above it).
 *
 * imapflow hands back requested headers as a buffer rather than a parsed map. A
 * References chain is routinely long enough to be folded across several lines,
 * and reading only the first of them loses exactly the ids we need to match on.
 */
export function extractHeader(raw: unknown, name: string): string | undefined {
  if (!raw) return undefined;
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  const lines = text.split(/\r?\n/);
  const wanted = `${name.toLowerCase()}:`;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().startsWith(wanted)) continue;
    let value = lines[i].slice(wanted.length);
    // Fold continuation lines up into the value.
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
      value += ` ${lines[++i].trim()}`;
    }
    return value.trim() || undefined;
  }
  return undefined;
}

/** How an inbound message was tied to what we sent. Ordered most to least certain. */
export type MatchKind = "header" | "thread" | "address" | "none";

/**
 * Is this a *verified* reply — one we can prove answers a message we sent?
 *
 * Only "header" qualifies. That is the whole point of the change: an address
 * match alone is a coincidence, and coincidences should not stop campaigns.
 */
export function isVerifiedReply(kind: MatchKind): boolean {
  return kind === "header";
}
