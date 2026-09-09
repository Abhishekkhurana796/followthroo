/**
 * Mailbox reply poller + warm-up detector.
 *
 * For each active sending account:
 *  - gmail_oauth → Gmail API (needs gmail.modify scope) — inbox + spam passes.
 *  - smtp        → IMAP (imapflow, optional dep) INBOX.
 *
 * A message whose From is one of the org's OWN mailboxes is a warm-up email → recorded as a
 * WarmupEvent (placement inbox/spam) and rescued out of spam. Everything else is a real
 * reply → recorded via the inbox store (marks the lead "replied" for the campaign engine),
 * and rescued from spam too so replies are never missed.
 *
 * Runs on a schedule (Vercel Cron / QStash) hitting /api/inbox/poll.
 */
import { prisma } from "../db";
import { gmailAccessToken } from "../channels/email";
import { recordInbound } from "./store";
import { extractHeader } from "./threading";
import { parseLeadEmail } from "../email-lead-parser";
import { ingestMany } from "../ingest";

interface PollCounts {
  fetched: number;
  recorded: number;
  matched: number;
  warmup: number;
}
interface PollSummary extends PollCounts {
  account: string;
  provider: string;
  error?: string;
  /** Set when polling was skipped for a reason that is not an error. */
  note?: string;
}

function parseAddress(header?: string): string {
  if (!header) return "";
  const m = header.match(/<([^>]+)>/);
  return (m ? m[1] : header).trim().toLowerCase();
}

/**
 * Routes one inbound message to the right place: a reply on an existing lead's thread
 * (the normal case), or — when this mailbox is a lead-aggregator's notification inbox
 * (SendingAccount.leadSourceKey set, dev PRD §3.7-3.8) — parsed as a brand-new lead and
 * ingested through the same identity/pipeline path every other source uses.
 */
async function handleInboundMessage(
  orgId: string,
  leadSourceKey: string | null,
  input: {
    fromAddr: string;
    toAddr?: string;
    subject?: string;
    body?: string;
    providerMessageId?: string;
    rfcMessageId?: string;
    inReplyTo?: string;
    references?: string;
    sentAt?: Date;
  },
): Promise<{ recorded: boolean; matched: boolean }> {
  if (!leadSourceKey) return recordInbound(orgId, input);

  const event = parseLeadEmail(leadSourceKey, { subject: input.subject, body: input.body });
  if (!event) return { recorded: false, matched: false };
  if (input.providerMessageId) event.externalId = `${leadSourceKey}:${input.providerMessageId}`;
  if (input.sentAt) event.occurredAt = input.sentAt;

  const result = await ingestMany(orgId, [event]);
  return { recorded: result.received > 0, matched: result.created > 0 };
}

/** Record a received warm-up email (deduped by provider id). */
async function recordWarmupReceived(orgId: string, receivingAccountId: string, placement: "inbox" | "spam", providerMessageId?: string): Promise<boolean> {
  if (providerMessageId) {
    const dup = await prisma.warmupEvent.findFirst({ where: { organizationId: orgId, providerMessageId, direction: "received" } });
    if (dup) return false;
  }
  await prisma.warmupEvent.create({
    data: { organizationId: orgId, sendingAccountId: receivingAccountId, direction: "received", placement, rescued: placement === "spam", providerMessageId },
  });
  return true;
}

// ---- Gmail ----
async function gmailList(token: string, query: string): Promise<string[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=25`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail list failed: ${j.error?.message || res.status}`);
  return (j.messages ?? []).map((m: { id: string }) => m.id);
}

async function gmailModify(token: string, id: string, removeLabelIds: string[]) {
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds }),
  }).catch(() => {});
}

async function pollGmail(orgId: string, accountId: string, refreshToken: string, sinceMs: number, orgEmails: Set<string>, leadSourceKey: string | null): Promise<PollCounts> {
  const token = await gmailAccessToken(refreshToken);
  const afterSec = Math.floor(sinceMs / 1000);
  const counts: PollCounts = { fetched: 0, recorded: 0, matched: 0, warmup: 0 };

  async function handle(id: string, inSpam: boolean) {
    const res = await fetch(
      // Message-ID / In-Reply-To / References are what turn "mail from a contact"
      // into "a reply to a specific campaign send" (lib/inbox/threading.ts).
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata` +
        "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject" +
        "&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msg = await res.json().catch(() => ({}));
    if (!res.ok) return;
    counts.fetched++;
    const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
    const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value;
    const from = parseAddress(get("From"));
    if (!from) return;

    if (orgEmails.has(from)) {
      if (await recordWarmupReceived(orgId, accountId, inSpam ? "spam" : "inbox", id)) counts.warmup++;
      if (inSpam) await gmailModify(token, id, ["SPAM"]); // rescue warm-up
      return;
    }
    const r = await handleInboundMessage(orgId, leadSourceKey, {
      fromAddr: from,
      toAddr: parseAddress(get("To")),
      subject: get("Subject"),
      body: msg.snippet,
      providerMessageId: id,
      rfcMessageId: get("Message-ID"),
      inReplyTo: get("In-Reply-To"),
      references: get("References"),
      sentAt: msg.internalDate ? new Date(Number(msg.internalDate)) : undefined,
    });
    if (r.recorded) counts.recorded++;
    if (r.matched) counts.matched++;
    if (inSpam) await gmailModify(token, id, ["SPAM"]); // rescue a real reply from spam
  }

  for (const id of await gmailList(token, `in:inbox after:${afterSec}`)) await handle(id, false);
  for (const id of await gmailList(token, `in:spam after:${afterSec}`)) await handle(id, true);
  return counts;
}

// ---- IMAP (optional dep) ----
async function pollImap(
  orgId: string,
  account: { id: string; host: string | null; imapHost: string | null; imapPort: number | null; user: string | null; pass: string | null },
  sinceMs: number,
  orgEmails: Set<string>,
  leadSourceKey: string | null
): Promise<PollCounts> {
  let ImapFlow: unknown;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch {
    throw new Error("imapflow not installed — run `npm i imapflow` to enable SMTP inbox polling");
  }
  const host = account.imapHost || account.host?.replace(/^smtp\./, "imap.");
  if (!host || !account.user || !account.pass) throw new Error("account missing IMAP host/user/pass");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new (ImapFlow as any)({ host, port: account.imapPort || 993, secure: true, auth: { user: account.user, pass: account.pass }, logger: false });
  const counts: PollCounts = { fetched: 0, recorded: 0, matched: 0, warmup: 0 };

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(sinceMs);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // `headers` in addition to the envelope: envelope gives messageId and
      // inReplyTo, but not References, which is the one that keeps matching
      // past the first exchange in a long thread.
      for await (const msg of client.fetch({ since }, { envelope: true, uid: true, headers: ["references"] }) as any) {
        counts.fetched++;
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
        if (!from) continue;
        const providerMessageId = msg.envelope?.messageId || `imap-${account.id}-${msg.uid}`;
        if (orgEmails.has(from)) {
          if (await recordWarmupReceived(orgId, account.id, "inbox", providerMessageId)) counts.warmup++;
          continue;
        }
        // imapflow hands back the requested headers as a raw buffer. Unfolding
        // by hand rather than regexing: a References chain is long and RFC-822
        // folds it across continuation lines that start with whitespace.
        const referencesHeader = extractHeader(msg.headers, "references");
        const r = await handleInboundMessage(orgId, leadSourceKey, {
          fromAddr: from,
          toAddr: msg.envelope?.to?.[0]?.address,
          subject: msg.envelope?.subject,
          providerMessageId,
          rfcMessageId: msg.envelope?.messageId,
          inReplyTo: msg.envelope?.inReplyTo,
          references: referencesHeader,
          sentAt: msg.envelope?.date ? new Date(msg.envelope.date) : undefined,
        });
        if (r.recorded) counts.recorded++;
        if (r.matched) counts.matched++;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return counts;
}

/** Poll every active sending account in an org. */
export async function pollOrgInbox(orgId: string): Promise<PollSummary[]> {
  const accounts = await prisma.sendingAccount.findMany({ where: { organizationId: orgId, active: true } });
  const orgEmails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const lookbackMs = 2 * 24 * 60 * 60 * 1000;
  const results: PollSummary[] = [];

  for (const acc of accounts) {
    const sinceMs = acc.lastPolledAt?.getTime() ?? Date.now() - lookbackMs;
    const base = { account: acc.email, provider: acc.provider };
    try {
      const r =
        acc.provider === "gmail_oauth" && acc.refreshToken
          ? await pollGmail(orgId, acc.id, acc.refreshToken, sinceMs, orgEmails, acc.leadSourceKey)
          : // Zoho polls over IMAP with an app-specific password when one is set.
            // The OAuth scopes we request cover sending and account lookup only,
            // so a Zoho mailbox connected purely by OAuth can send but cannot be
            // polled — surfaced as a clear reason rather than silent silence,
            // because "no replies ever arrive" is the worst way to learn that.
            acc.provider === "zoho_oauth"
            ? acc.pass
              ? await pollImap(orgId, acc, sinceMs, orgEmails, acc.leadSourceKey)
              : { fetched: 0, recorded: 0, matched: 0, warmup: 0, note: "add an app password in Settings to poll this Zoho mailbox for replies" }
            : acc.provider === "smtp"
              ? await pollImap(orgId, acc, sinceMs, orgEmails, acc.leadSourceKey)
              : { fetched: 0, recorded: 0, matched: 0, warmup: 0 };
      await prisma.sendingAccount.update({ where: { id: acc.id }, data: { lastPolledAt: new Date() } });
      results.push({ ...base, ...r });
    } catch (e) {
      results.push({ ...base, fetched: 0, recorded: 0, matched: 0, warmup: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/** Poll every org with an active sending account (cron entry point). */
export async function pollAllInboxes(): Promise<{ orgs: number; summaries: Record<string, PollSummary[]> }> {
  const orgs = await prisma.sendingAccount.findMany({
    where: { active: true, organizationId: { not: null } },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  const summaries: Record<string, PollSummary[]> = {};
  for (const { organizationId } of orgs) {
    if (!organizationId) continue;
    summaries[organizationId] = await pollOrgInbox(organizationId);
  }
  return { orgs: orgs.length, summaries };
}
