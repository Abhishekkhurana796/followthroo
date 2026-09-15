import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/http";
import { leadScope } from "@/lib/scope";
import { leadWhere, readLeadFilters } from "@/lib/lead-filters";
import { requireOrg, requireRole } from "@/lib/tenant";

export const runtime = "nodejs";

const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/** Admin-only PII export. It reuses the exact table filters and authorized scope. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;

  const filters = readLeadFilters(req.nextUrl.searchParams);
  const scope = await leadScope(ctx);
  const where = await leadWhere(ctx.orgId, scope.where, filters);
  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10_000,
    include: { leadSource: { select: { key: true, label: true } } },
  }).catch(() => null);
  if (!leads) return fail("Could not prepare the lead export.", 500);

  const customColumns = Array.from(new Set(leads.flatMap((lead) => Object.keys((lead.custom ?? {}) as Record<string, unknown>)))).sort();
  const headers = ["first name", "last name", "email", "phone", "linkedin url", "company", "title", "stage", "tags", "source", "created at", ...customColumns];
  const lines = [headers.map(cell).join(",")];
  for (const lead of leads) {
    const custom = (lead.custom ?? {}) as Record<string, unknown>;
    lines.push([
      lead.firstName, lead.lastName, lead.email, lead.phone, lead.linkedinUrl, lead.company, lead.title, lead.stage,
      lead.tags.join(", "), lead.leadSource?.label ?? lead.leadSource?.key ?? "", lead.createdAt.toISOString(),
      ...customColumns.map((key) => custom[key]),
    ].map(cell).join(","));
  }
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="followthroo-leads.csv"',
      "cache-control": "no-store",
    },
  });
}
