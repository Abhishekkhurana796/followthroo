/**
 * Template versioning, and the three ways an edit can land.
 *
 * The problem this solves: lib/job-processor.ts resolves a template's body at
 * the moment of sending, from templateId alone. So an edit silently rewrote
 * every unsent step of every running sequence — a contact half way through a
 * five-touch campaign would get touches 1-2 in the old wording and 3-5 in the
 * new, with nobody having asked for that.
 *
 * So an edit has to say what it means:
 *
 *   future_only  — snapshot the old wording and pin every running campaign to
 *                  it. New campaigns pick up the new text. (The safe default.)
 *   this_campaign — as above, then repoint one named campaign's steps at the new
 *                  version, so its unsent messages do change.
 *   new_version  — save a version and repoint nothing. For drafting ahead.
 */
import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

export const APPLY_MODES = ["future_only", "this_campaign", "new_version"] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];

/** `{{firstName}}` and `{{company|there}}` — the two forms lib/templates.ts renders. */
const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|[^}]*)?\}\}/g;

/**
 * The variables a body actually uses.
 *
 * `Template.variables` existed as a column but was written as `[]` forever, so
 * nothing could warn that a template referenced a field no contact has. Derived
 * at save time rather than asked for, because a list the author has to maintain
 * by hand is a list that goes stale.
 */
export function extractVariables(subject: string | null | undefined, body: string): string[] {
  const found = new Set<string>();
  for (const text of [subject ?? "", body]) {
    for (const m of text.matchAll(VAR_RE)) found.add(m[1]);
  }
  return [...found].sort();
}

/** Snapshot a template's current wording. Returns the new version row. */
export async function snapshotTemplate(templateId: string, createdById?: string | null) {
  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) throw new Error("Template not found");

  const last = await prisma.templateVersion.findFirst({
    where: { templateId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  return prisma.templateVersion.create({
    data: {
      templateId,
      version: (last?.version ?? 0) + 1,
      subject: tpl.subject,
      body: tpl.body,
      variables: tpl.variables as Prisma.InputJsonValue,
      createdById: createdById ?? tpl.createdById,
    },
  });
}

type SequenceNode = { type?: string; templateId?: string | null; templateVersionId?: string | null };

/**
 * Pin every send step that uses this template to a specific version.
 *
 * `onlyUnpinned` is what separates "protect what is running" from "update this
 * campaign": protecting must not stomp a campaign that was already pinned to an
 * older snapshot on purpose.
 */
async function pinCampaigns(
  organizationId: string,
  templateId: string,
  versionId: string,
  opts: { campaignId?: string; onlyUnpinned: boolean; statuses?: string[] }
): Promise<number> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId,
      ...(opts.campaignId ? { id: opts.campaignId } : {}),
      ...(opts.statuses ? { status: { in: opts.statuses as never } } : {}),
    },
    select: { id: true, sequence: true },
  });

  let changed = 0;
  for (const c of campaigns) {
    const nodes = c.sequence as unknown as SequenceNode[];
    if (!Array.isArray(nodes)) continue;
    let touched = false;
    for (const n of nodes) {
      if (n?.type !== "send" || n.templateId !== templateId) continue;
      if (opts.onlyUnpinned && n.templateVersionId) continue;
      if (n.templateVersionId === versionId) continue;
      n.templateVersionId = versionId;
      touched = true;
    }
    if (touched) {
      await prisma.campaign.update({
        where: { id: c.id },
        data: { sequence: nodes as unknown as Prisma.InputJsonValue },
      });
      changed++;
    }
  }
  return changed;
}

export interface ApplyResult {
  versionId: string;
  version: number;
  /** How many campaigns had steps repointed or protected. */
  campaignsAffected: number;
}

/**
 * Save an edit under one of the three modes.
 *
 * Order matters in `future_only` and `this_campaign`: the snapshot is taken
 * BEFORE the template row is updated, so what gets pinned is the wording those
 * campaigns were actually built with.
 */
export async function applyTemplateEdit(
  organizationId: string,
  templateId: string,
  next: { name?: string; subject?: string | null; body?: string },
  mode: ApplyMode,
  opts: { campaignId?: string; userId?: string | null } = {}
): Promise<ApplyResult> {
  const existing = await prisma.template.findFirst({ where: { id: templateId, organizationId } });
  if (!existing) throw new Error("Template not found");

  // Snapshot the OLD wording first — that is what running campaigns keep.
  const snapshot = await snapshotTemplate(templateId, opts.userId);

  let campaignsAffected = 0;
  if (mode === "future_only" || mode === "this_campaign") {
    // Pin everything that is running and not already deliberately pinned.
    campaignsAffected += await pinCampaigns(organizationId, templateId, snapshot.id, {
      onlyUnpinned: true,
      statuses: ["active", "paused"],
    });
  }

  const subject = next.subject !== undefined ? next.subject : existing.subject;
  const body = next.body !== undefined ? next.body : existing.body;

  await prisma.template.update({
    where: { id: templateId },
    data: {
      ...(next.name !== undefined ? { name: next.name } : {}),
      subject,
      body,
      variables: extractVariables(subject, body) as unknown as Prisma.InputJsonValue,
    },
  });

  if (mode === "this_campaign" && opts.campaignId) {
    // The named campaign gets the NEW wording, so snapshot again post-update and
    // point it there. Its unsent messages change; every other campaign does not.
    const updatedSnapshot = await snapshotTemplate(templateId, opts.userId);
    campaignsAffected += await pinCampaigns(organizationId, templateId, updatedSnapshot.id, {
      campaignId: opts.campaignId,
      onlyUnpinned: false,
    });
    return { versionId: updatedSnapshot.id, version: updatedSnapshot.version, campaignsAffected };
  }

  return { versionId: snapshot.id, version: snapshot.version, campaignsAffected };
}

/** Campaigns whose sequence references this template — used to warn before archiving. */
export async function campaignsUsingTemplate(organizationId: string, templateId: string) {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId, status: { in: ["active", "paused"] } },
    select: { id: true, name: true, status: true, sequence: true },
  });
  return campaigns
    .filter((c) => {
      const nodes = c.sequence as unknown as SequenceNode[];
      return Array.isArray(nodes) && nodes.some((n) => n?.type === "send" && n.templateId === templateId);
    })
    .map(({ id, name, status }) => ({ id, name, status }));
}
