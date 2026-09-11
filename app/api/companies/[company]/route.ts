import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ company: string }> };

/**
 * A "company" is not its own row — it's just the value of `Lead.company`,
 * grouped (see `getCompanies` in lib/queries.ts). Renaming or deleting one is
 * therefore a bulk update/clear across every lead currently grouped under it,
 * matched case-insensitively so it catches every casing variant the same way
 * the company's own detail page (`/api/leads?company=`) already does.
 */

const renameSchema = z.object({ name: z.string().trim().min(1).max(200) });

// PATCH /api/companies/[company] — rename: re-point every lead at the new name.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;
  const { company } = await params;

  const body = await req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid name", 400);

  const { count } = await prisma.lead.updateMany({
    where: { organizationId: ctx.orgId, company: { equals: company, mode: "insensitive" } },
    data: { company: parsed.data.name },
  });
  return ok({ renamed: count, name: parsed.data.name });
}

// DELETE /api/companies/[company] — ungroup: clear the company field, leads stay.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;
  const { company } = await params;

  const { count } = await prisma.lead.updateMany({
    where: { organizationId: ctx.orgId, company: { equals: company, mode: "insensitive" } },
    data: { company: null },
  });
  return ok({ cleared: count });
}
