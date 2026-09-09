import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { APPLY_MODES, applyTemplateEdit, campaignsUsingTemplate, extractVariables } from "@/lib/template-versions";
import { renderMessage, spamScore, formatEmailBody } from "@/lib/templates";
import { safeSend } from "@/lib/channels";
import { defaultSendingAccountId } from "@/lib/channels/email";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Templates were create-only: there was no [id] route at all, so nothing in the
 * product could edit, duplicate, archive or preview one. This is that route.
 *
 * The interesting part is PATCH — see lib/template-versions.ts for why an edit
 * has to declare what it means for campaigns that are already running.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const template = await prisma.template.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, subject: true, body: true, createdAt: true, createdById: true },
      },
    },
  });
  if (!template) return fail("Template not found", 404);

  return ok({
    ...template,
    // Surfacing this was free — spamScore has existed in lib/templates.ts since
    // the beginning, wired to nothing, while ROADMAP.md claimed it had shipped.
    spam: spamScore(`${template.subject ?? ""}\n${template.body}`),
    usedBy: await campaignsUsingTemplate(ctx.orgId, id),
  });
}

const UpdateTemplate = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
  /** What to do about campaigns already running on this template. */
  apply: z.enum(APPLY_MODES).default("future_only"),
  /** Required when apply is "this_campaign". */
  campaignId: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const parsed = UpdateTemplate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");
  const { apply, campaignId, ...next } = parsed.data;

  if (apply === "this_campaign" && !campaignId) {
    return fail("Choosing 'this campaign' needs a campaignId.", 400);
  }
  if (campaignId) {
    const owned = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (!owned) return fail("Campaign not found", 404);
  }

  try {
    const result = await applyTemplateEdit(ctx.orgId, id, next, apply, { campaignId, userId: ctx.userId });
    const template = await prisma.template.findUnique({ where: { id } });
    return ok({ ...template, ...result });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update template", 400);
  }
}

/**
 * Archive, not delete.
 *
 * A hard delete leaves Message.templateId dangling, and because the body is
 * resolved at send time a missing template resolves to null — which sends an
 * EMPTY email rather than failing. `?hard=true` is allowed only when nothing
 * running references it.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const template = await prisma.template.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!template) return fail("Template not found", 404);

  const usedBy = await campaignsUsingTemplate(ctx.orgId, id);
  if (usedBy.length > 0) {
    return fail(
      `Still used by ${usedBy.length} running campaign${usedBy.length === 1 ? "" : "s"}: ${usedBy
        .map((c) => c.name)
        .join(", ")}. Pause them first, or archive this template instead.`,
      409
    );
  }

  if (req.nextUrl.searchParams.get("hard") === "true") {
    await prisma.template.delete({ where: { id } });
    return ok({ deleted: true });
  }

  await prisma.template.update({ where: { id }, data: { archivedAt: new Date() } });
  return ok({ archived: true });
}

const Action = z.object({
  action: z.enum(["duplicate", "restore", "preview", "test_send"]),
  /** preview / test_send: render against a real contact rather than placeholders. */
  leadId: z.string().optional(),
});

/** POST /api/templates/[id] — duplicate, restore, preview, test send. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");

  const template = await prisma.template.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!template) return fail("Template not found", 404);

  if (parsed.data.action === "duplicate") {
    const copy = await prisma.template.create({
      data: {
        organizationId: ctx.orgId,
        channel: template.channel,
        name: `${template.name} (copy)`,
        subject: template.subject,
        body: template.body,
        variables: extractVariables(template.subject, template.body),
        createdById: ctx.userId,
      },
    });
    return ok(copy, { status: 201 });
  }

  if (parsed.data.action === "restore") {
    const restored = await prisma.template.update({ where: { id }, data: { archivedAt: null } });
    return ok(restored);
  }

  // preview / test_send both need a contact to render against.
  const lead = parsed.data.leadId
    ? await prisma.lead.findFirst({ where: { id: parsed.data.leadId, organizationId: ctx.orgId } })
    : await prisma.lead.findFirst({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" } });
  if (!lead) return fail("Add a contact first — a preview renders against a real one.", 400);

  const rendered = renderMessage(template, lead, { senderName: undefined });

  if (parsed.data.action === "preview") {
    return ok({
      subject: rendered.subject,
      body: rendered.body,
      html: formatEmailBody(rendered.body),
      renderedAgainst: { id: lead.id, name: [lead.firstName, lead.lastName].filter(Boolean).join(" "), email: lead.email },
      // Any variable still in braces had no value on this contact.
      unresolved: extractVariables(rendered.subject ?? "", rendered.body),
      spam: spamScore(`${rendered.subject ?? ""}\n${rendered.body}`),
    });
  }

  // Test send goes to the signed-in user, never to the contact whose data was
  // used to render it.
  const me = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
  if (!me?.email) return fail("Your account has no email address to send a test to.", 400);

  const account = await defaultSendingAccountId(ctx.orgId);
  if (!account) return fail("Connect a mailbox before sending a test.", 400);

  const result = await safeSend(
    template.channel === "email" ? "email" : template.channel,
    { id: lead.id, email: me.email, phone: null, linkedinUrl: null, firstName: lead.firstName },
    { subject: rendered.subject ? `[Test] ${rendered.subject}` : "[Test]", body: rendered.body },
    account,
    ctx.orgId
  );

  if (!result.ok) return fail(result.error ?? result.reason ?? "Test send failed", 400);
  return ok({ sent: true, to: me.email });
}
