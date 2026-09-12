import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { SEED_TEMPLATES } from "@/lib/templates-seed";
import { requireLimit, roomFor } from "@/lib/billing/limits";

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

  // ?archived=1 — archived templates, so one can be restored or deleted for good.
  // Without this list, Archive was a one-way door: the template vanished and
  // nothing in the app could bring it back or remove it properly.
  if (req.nextUrl.searchParams.get("archived")) {
    return ok(
      await prisma.template.findMany({
        where: { organizationId: orgId, archivedAt: { not: null } },
        orderBy: { archivedAt: "desc" },
      }),
    );
  }

  let templates = await prisma.template.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { createdAt: "desc" } });

  // Seed the org's first set of starter templates on first visit — no more than
  // the plan has room for. There are five, and a Test Drive holds three.
  if (templates.length === 0) {
    const room = await roomFor(orgId, "templates");
    const seed = SEED_TEMPLATES.slice(0, Math.min(SEED_TEMPLATES.length, room));
    if (seed.length) {
      console.log(`[templates] Seeding ${seed.length} starter templates for org ${orgId}...`);
      await prisma.template.createMany({ data: seed.map((t) => ({ ...t, organizationId: orgId })) });
      templates = await prisma.template.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { createdAt: "desc" } });
    }
  }

  return ok(templates);
}

export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const parsed = CreateTemplate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid body");
  const full = await requireLimit(ctx.orgId, "templates");
  if (full) return full;
  const tpl = await prisma.template.create({ data: { ...parsed.data, organizationId: ctx.orgId } });
  return ok(tpl, { status: 201 });
}
