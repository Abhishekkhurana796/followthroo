import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { SEED_TEMPLATES } from "@/lib/templates-seed";

export const runtime = "nodejs";

const CreateTemplate = z.object({
  channel: z.enum(["email", "linkedin", "whatsapp", "social"]),
  name: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { orgId } = ctx;

  let templates = await prisma.template.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { createdAt: "desc" } });

  // Seed the org's first set of starter templates on first visit.
  if (templates.length === 0) {
    console.log(`[templates] Seeding starter templates for org ${orgId}...`);
    await prisma.template.createMany({ data: SEED_TEMPLATES.map((t) => ({ ...t, organizationId: orgId })) });
    templates = await prisma.template.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  }

  return ok(templates);
}

export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = CreateTemplate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");
  const tpl = await prisma.template.create({ data: { ...parsed.data, organizationId: ctx.orgId } });
  return ok(tpl, { status: 201 });
}
