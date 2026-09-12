/**
 * Single dispatch point for queued jobs, shared by every transport:
 * the QStash webhook, the BullMQ worker, and the dev inline runner.
 */
import type { QueueJob } from "./queue";
import { processSendJob } from "./job-processor";
import { advanceEnrollment } from "./campaign-engine";
import { sendCaptureAck } from "./notify";
import { verifyDomainDns } from "./domains/provision";
import { publishScheduledPost } from "./posts/schedule";

export async function runJob(job: QueueJob): Promise<unknown> {
  if (job.kind === "advance") return advanceEnrollment(job.enrollmentId);
  if (job.kind === "lead-ack") return sendCaptureAck(job.organizationId, job.leadId);
  if (job.kind === "domain-verify-dns") return verifyDomainDns(job.domainId);
  if (job.kind === "post-publish") return publishScheduledPost(job.postId);
  return processSendJob(job);
}
