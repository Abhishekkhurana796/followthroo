/**
 * Verification for template editing + versioning (lib/template-versions.ts).
 *
 * The behaviour under test is the one the "Apply changes to" dialog promises:
 * editing a template must not silently rewrite messages that are already
 * queued in a running campaign, unless you say that is what you want.
 *
 *   npx tsx --env-file=.env.local scripts/verify-template-versions.ts
 */
import { prisma } from "../lib/db";
import { applyTemplateEdit, extractVariables, snapshotTemplate, campaignsUsingTemplate } from "../lib/template-versions";
import type { Prisma } from "@prisma/client";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string, extra = "") => {
  if (c) {
    pass++;
    console.log("  ok  ", m, extra);
  } else {
    fail++;
    console.log("  FAIL", m, extra);
  }
};

/** What processSendJob would resolve for a step, given its pin. */
async function resolveBody(templateId: string, versionId: string | null | undefined, orgId: string) {
  if (versionId) {
    const v = await prisma.templateVersion.findFirst({
      where: { id: versionId, templateId, template: { organizationId: orgId } },
      select: { body: true },
    });
    if (v) return v.body;
  }
  return (await prisma.template.findFirst({ where: { id: templateId, organizationId: orgId } }))?.body ?? null;
}

const sendNode = (templateId: string) => [
  { id: "n1", type: "send", channel: "email", templateId, waitDays: 0, next: null },
];

async function main() {
  ok(extractVariables("Hi {{firstName}}", "at {{company|your company}}").join(",") === "company,firstName",
    "extractVariables reads both plain and fallback forms");
  ok(extractVariables(null, "no variables here").length === 0, "extractVariables on a plain body");

  const stamp = Date.now();
  const org = await prisma.organization.create({ data: { name: "tpl-test", slug: `tpl-test-${stamp}` } });
  const orgId = org.id;

  const tpl = await prisma.template.create({
    data: { organizationId: orgId, channel: "email", name: "HR Outreach", subject: "Original subject", body: "ORIGINAL body {{firstName}}" },
  });

  const running = await prisma.campaign.create({
    data: { organizationId: orgId, name: "Running campaign", status: "active", sequence: sendNode(tpl.id) as unknown as Prisma.InputJsonValue },
  });
  const other = await prisma.campaign.create({
    data: { organizationId: orgId, name: "Other running campaign", status: "active", sequence: sendNode(tpl.id) as unknown as Prisma.InputJsonValue },
  });

  ok((await campaignsUsingTemplate(orgId, tpl.id)).length === 2, "both running campaigns are seen as using the template");

  // ---- future_only: running campaigns must keep the old wording -----------
  const r1 = await applyTemplateEdit(orgId, tpl.id, { body: "EDITED body {{firstName}}" }, "future_only", { userId: null });
  ok(r1.version === 1, "first edit snapshots version 1", `(v${r1.version})`);
  ok(r1.campaignsAffected === 2, "both running campaigns were pinned", `(${r1.campaignsAffected})`);

  const live = await prisma.template.findUnique({ where: { id: tpl.id } });
  ok(live?.body === "EDITED body {{firstName}}", "the template itself now holds the new wording");
  ok(
    JSON.stringify(live?.variables) === JSON.stringify(["firstName"]),
    "variables are derived on save",
    JSON.stringify(live?.variables)
  );

  const runNodes = (await prisma.campaign.findUnique({ where: { id: running.id } }))!.sequence as unknown as { templateVersionId?: string }[];
  const pinned = runNodes[0].templateVersionId;
  ok(!!pinned, "the running campaign's step is pinned to a version");
  ok(
    (await resolveBody(tpl.id, pinned, orgId)) === "ORIGINAL body {{firstName}}",
    "a queued message in a running campaign still resolves the ORIGINAL wording"
  );

  // A brand-new campaign has no pin, so it picks up the new wording.
  ok((await resolveBody(tpl.id, null, orgId)) === "EDITED body {{firstName}}", "a new campaign picks up the edit");

  // ---- this_campaign: one named campaign DOES change ----------------------
  const r2 = await applyTemplateEdit(orgId, tpl.id, { body: "SECOND edit {{firstName}}" }, "this_campaign", {
    campaignId: running.id,
    userId: null,
  });
  ok(r2.campaignsAffected >= 1, "the named campaign was repointed", `(${r2.campaignsAffected})`);

  const runNodes2 = (await prisma.campaign.findUnique({ where: { id: running.id } }))!.sequence as unknown as { templateVersionId?: string }[];
  ok(
    (await resolveBody(tpl.id, runNodes2[0].templateVersionId, orgId)) === "SECOND edit {{firstName}}",
    "the named campaign's unsent messages now use the new wording"
  );

  const otherNodes = (await prisma.campaign.findUnique({ where: { id: other.id } }))!.sequence as unknown as { templateVersionId?: string }[];
  ok(
    (await resolveBody(tpl.id, otherNodes[0].templateVersionId, orgId)) === "ORIGINAL body {{firstName}}",
    "the OTHER campaign is untouched — still on its original pin"
  );

  // ---- new_version: nothing is repointed ----------------------------------
  const beforePins = otherNodes[0].templateVersionId;
  await applyTemplateEdit(orgId, tpl.id, { body: "THIRD edit" }, "new_version", { userId: null });
  const otherNodes2 = (await prisma.campaign.findUnique({ where: { id: other.id } }))!.sequence as unknown as { templateVersionId?: string }[];
  ok(otherNodes2[0].templateVersionId === beforePins, "new_version repoints nothing");

  const versions = await prisma.templateVersion.findMany({ where: { templateId: tpl.id }, orderBy: { version: "asc" } });
  ok(versions.length >= 3, "version history accumulates", `(${versions.length} versions)`);
  ok(versions.every((v, i) => v.version === i + 1), "versions are numbered 1..n without gaps");

  // ---- a foreign pin must not resolve -------------------------------------
  const otherOrg = await prisma.organization.create({ data: { name: "tpl-other", slug: `tpl-other-${stamp}` } });
  const foreignTpl = await prisma.template.create({
    data: { organizationId: otherOrg.id, channel: "email", name: "Foreign", subject: null, body: "FOREIGN" },
  });
  const foreignVersion = await snapshotTemplate(foreignTpl.id, null);
  ok(
    (await resolveBody(tpl.id, foreignVersion.id, orgId)) === "THIRD edit",
    "a version id from another tenant does not resolve — it falls back to the live copy"
  );

  // cleanup
  await prisma.templateVersion.deleteMany({ where: { template: { organizationId: { in: [orgId, otherOrg.id] } } } });
  await prisma.template.deleteMany({ where: { organizationId: { in: [orgId, otherOrg.id] } } });
  await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrg.id] } } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
