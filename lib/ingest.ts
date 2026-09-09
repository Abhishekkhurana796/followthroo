/**
 * One ingestion path for every inbound source.
 *
 * Adapters differ; what happens to their output must not. Every event resolves
 * through the identity graph, writes to the unified conversation timeline, tags
 * its source, and enters the department's pipeline — so a Meta lead, an
 * IndiaMART push and a website form are indistinguishable downstream.
 */
import { prisma } from "./db";
import { resolveContact, ensureSource } from "./identity";
import { ensureDefaultPipeline, addToPipeline } from "./pipeline";
import { resolveLeadOwner } from "./assignment";
import { isSuppressed } from "./crm";
import { invalidate } from "./cache";
import { notifyOnCapture } from "./notify";
import { recomputeAndSaveLeadScore } from "./scoring";
import type { InboundEvent } from "./channels/types";

export type IngestResult = {
  leadId: string | null;
  created: boolean;
  merged: string[];
  suppressed: boolean;
  duplicate: boolean;
};

export async function ingestEvent(organizationId: string, event: InboundEvent): Promise<IngestResult> {
  const base: IngestResult = { leadId: null, created: false, merged: [], suppressed: false, duplicate: false };

  if (event.identities.length === 0) return base;

  // Resolve first, so even a suppressed contact's history stays on one record.
  const resolved = await resolveContact({
    organizationId,
    identities: event.identities,
    profile: event.profile,
    sourceKey: event.sourceKey,
    source: event.sourceKey,
  });

  const email = event.identities.find((i) => i.kind === "email")?.value;
  const phone = event.identities.find((i) => i.kind === "phone")?.value;
  const suppressed = await isSuppressed(organizationId, { email, phone });

  // Webhook retries are expected — Meta retries for up to 48h — so dedupe on
  // the provider's own id rather than trusting delivery to be exactly-once.
  let duplicate = false;
  if (event.externalId) {
    const existing = await prisma.conversationEvent.findUnique({
      where: {
        organizationId_channel_externalId: {
          organizationId,
          channel: event.channel,
          externalId: event.externalId,
        },
      },
      select: { id: true },
    });
    if (existing) duplicate = true;
  }

  if (!duplicate) {
    await prisma.conversationEvent.create({
      data: {
        organizationId,
        leadId: resolved.leadId,
        channel: event.channel,
        direction: event.direction,
        subject: event.subject ?? null,
        body: event.body ?? null,
        externalId: event.externalId ?? null,
        occurredAt: event.occurredAt ?? new Date(),
        meta: (event.meta ?? {}) as object,
      },
    });
  }

  // A suppressed contact is recorded but never enters a pipeline — putting them
  // on a board invites a rep to work someone who has opted out.
  if (!suppressed && !duplicate) {
    const pipeline = await ensureDefaultPipeline(organizationId);
    const sourceId = event.sourceKey ? await ensureSource(organizationId, event.sourceKey) : null;
    // Checked ahead of the (idempotent) call so the capture notification only fires once,
    // on the touch that actually creates the pipeline item — not on every repeat webhook.
    const alreadyInPipeline = await prisma.pipelineItem.findUnique({
      where: { pipelineId_leadId: { pipelineId: pipeline.id, leadId: resolved.leadId } },
      select: { id: true },
    });
    const item = await addToPipeline({
      organizationId,
      pipelineId: pipeline.id,
      leadId: resolved.leadId,
      sourceId,
    });

    // Put the contact itself on someone, per the source's rule. The pipeline
    // item has had an owner for a while; Lead.ownerId is what the scoped list
    // and the member dashboard actually read, and without it a webhook lead is
    // invisible to every rep now that there is no shared pool.
    if (!alreadyInPipeline) {
      const ownerId = item.ownerId ?? (await resolveLeadOwner(organizationId, { sourceKey: event.sourceKey }));
      if (ownerId) {
        await prisma.lead.update({ where: { id: resolved.leadId }, data: { ownerId } });
      }
    }

    if (!alreadyInPipeline) {
      await notifyOnCapture({ organizationId, leadId: resolved.leadId, ownerId: item.ownerId }).catch((e) =>
        console.error("[ingest] notifyOnCapture failed:", e),
      );
      await recomputeAndSaveLeadScore(resolved.leadId, organizationId);
    }
  }

  invalidate(`stats:${organizationId}`);
  invalidate(`activation:${organizationId}`);
  invalidate(`leads:`);

  return {
    leadId: resolved.leadId,
    created: resolved.created,
    merged: resolved.mergedLeadIds,
    suppressed,
    duplicate,
  };
}

export async function ingestMany(organizationId: string, events: InboundEvent[]) {
  const results: IngestResult[] = [];
  for (const e of events) results.push(await ingestEvent(organizationId, e));
  return {
    received: events.length,
    created: results.filter((r) => r.created).length,
    merged: results.reduce((n, r) => n + r.merged.length, 0),
    duplicates: results.filter((r) => r.duplicate).length,
    suppressed: results.filter((r) => r.suppressed).length,
    results,
  };
}
