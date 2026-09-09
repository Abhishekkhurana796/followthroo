/**
 * Job queue for throttled, scheduled work (see docs/ARCHITECTURE.md).
 *
 * Job kinds flowing through the same queue:
 *  - "send"    — deliver one message (used by ad-hoc sends).
 *  - "advance" — advance a campaign enrollment by one node (the conditional-node engine,
 *                see lib/campaign-engine.ts). The advance job performs the node's send
 *                inline and schedules the next advance.
 *  - "lead-ack" — a capture acknowledgment held until business hours reopen.
 *  - "domain-verify-dns" — re-check a sending domain's records against public DNS
 *                (lib/domains/provision.ts). Safe to retry: it only reads DNS and
 *                records what it saw.
 *
 * Transport: Upstash QStash in production, inline setTimeout in local dev.
 *
 * A BullMQ/Redis tier used to sit between the two. It was removed with its
 * consumer (lib/worker.ts): QStash has been the production transport since the
 * scheduler moved off vercel.json, nothing ran the worker, and a producer with
 * no consumer is worse than no producer at all — jobs enqueued there were
 * accepted and then silently never ran. Redis is still used, by lib/ratelimit.ts.
 */
import { env, configured } from "./env";
import type { Channel } from "./channels/types";

export interface SendJob {
  kind?: "send";
  organizationId: string;
  channel: Channel["name"];
  leadId: string;
  campaignId?: string;
  templateId?: string;
  /** Pinned template snapshot; falls back to the template's live copy. */
  templateVersionId?: string;
  account?: string;
  /** The sequence node this came from, so an action traces back to its step. */
  nodeId?: string;
  /** LinkedIn only: which gesture to draft. Rides the payload so a queued send
   *  keeps its kind across the wire. */
  linkedinAction?: "invite" | "message" | "auto";
}

export interface AdvanceJob {
  kind: "advance";
  enrollmentId: string;
}

/** A fixed-content capture acknowledgment, delayed until business hours reopen. Carries
 *  only ids (not pre-rendered content) so the lead's current data is what actually sends. */
export interface AckJob {
  kind: "lead-ack";
  organizationId: string;
  leadId: string;
}

/** Re-check a sending domain's records against public DNS, with backoff. */
export interface DomainVerifyDnsJob {
  kind: "domain-verify-dns";
  domainId: string;
}

export type QueueJob = SendJob | AdvanceJob | AckJob | DomainVerifyDnsJob;

/** Enqueue any job with an optional delay (ms) for sequencing + jitter. */
export async function enqueueJob(job: QueueJob, delayMs = 0): Promise<boolean> {
  // Use QStash in production if configured
  if (configured.qstash && !env.appUrl.includes("localhost")) {
    const delaySeconds = Math.max(0, Math.ceil(delayMs / 1000));
    const destinationUrl = `${env.appUrl}/api/qstash/process`;
    try {
      const response = await fetch(`${env.qstash.url}/v2/publish/${destinationUrl}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.qstash.token}`,
          "Content-Type": "application/json",
          "Upstash-Delay": `${delaySeconds}s`,
        },
        body: JSON.stringify(job),
      });
      if (!response.ok) {
        console.error(`[QStash] Failed to publish job: ${await response.text()}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error("[QStash] Connection error publishing job:", e);
      return false;
    }
  }

  // Local dev without QStash: run inline after the delay for convenience.
  if (process.env.NODE_ENV === "development") {
    console.warn(`[queue] QStash not configured. Running job inline (delay ${delayMs}ms)`);
    import("./job-router").then(({ runJob }) => {
      setTimeout(() => {
        runJob(job).catch((err) => console.error("[queue] Inline job failed:", err));
      }, delayMs);
    });
    return true;
  }

  // Refusing loudly beats accepting a job nothing will ever run.
  console.error("[queue] QStash is not configured — job dropped:", job.kind ?? "send");
  return false;
}
