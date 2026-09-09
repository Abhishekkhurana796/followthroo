import { NextRequest } from "next/server";
import Papa from "papaparse";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { ensureSource } from "@/lib/identity";
import { resolveLeadOwner } from "@/lib/assignment";
import { invalidate } from "@/lib/cache";

export const runtime = "nodejs";

// Known columns map onto lead fields; everything else becomes a custom variable.
const KNOWN = new Set([
  "email", "firstname", "name", "lastname", "phone",
  "linkedinurl", "linkedin", "linkedinprofile", "linkedinprofilelink", "profile", "profilelink", "profileurl",
  "company", "title",
]);

function normalizeRow(row: Record<string, string>) {
  const lead: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey.trim().toLowerCase().replace(/\s+/g, "");
    if (!value) continue;
    switch (key) {
      case "email": lead.email = value.trim().toLowerCase(); break;
      // "name" as a single column → first/last split (LinkedIn exports use one Name column).
      case "name": {
        const parts = value.trim().split(/\s+/);
        lead.firstName = parts[0];
        if (parts.length > 1) lead.lastName = parts.slice(1).join(" ");
        break;
      }
      case "firstname": lead.firstName = value; break;
      case "lastname": lead.lastName = value; break;
      case "phone": lead.phone = value; break;
      case "linkedinurl":
      case "linkedin":
      case "linkedinprofile":
      case "linkedinprofilelink":
      case "profile":
      case "profilelink":
      case "profileurl":
        lead.linkedinUrl = value.trim();
        break;
      case "company": lead.company = value; break;
      case "title": lead.title = value; break;
      default:
        if (!KNOWN.has(key)) custom[rawKey.trim()] = value;
    }
  }
  return { lead, custom };
}

// POST /api/leads/import  — body: raw CSV text (Content-Type text/csv) OR { csv: "..." }
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const { orgId } = ctx;

  const contentType = req.headers.get("content-type") ?? "";
  let csv: string;
  if (contentType.includes("application/json")) {
    const j = await req.json().catch(() => null);
    csv = j?.csv;
  } else {
    csv = await req.text();
  }
  if (!csv || csv.trim() === "") return fail("empty CSV");

  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) return fail(`CSV parse error: ${parsed.errors[0].message}`);

  // Imported contacts get the "csv" source and the importer as creator.
  //
  // They used to be left unassigned on the reasoning that importing 500 rows
  // does not make you the rep working all 500 — which was fine while unassigned
  // meant "in a pool everyone can see". It no longer does, so the csv source's
  // assignment rule now decides. Set it to round-robin and an import spreads
  // across the team; leave it manual and the rows land in Unassigned, visibly.
  const leadSourceId = await ensureSource(orgId, "csv");
  const provenance = { leadSourceId, createdById: ctx.userId, createdKind: "import" };

  const results = { imported: 0, skipped: 0, errors: [] as string[] };
  for (const row of parsed.data) {
    const { lead, custom } = normalizeRow(row);
    const email = lead.email as string | undefined;
    const linkedinUrl = lead.linkedinUrl as string | undefined;
    if (!email && !linkedinUrl) {
      results.skipped++;
      results.errors.push(`row needs an email or LinkedIn URL: ${JSON.stringify(row).slice(0, 80)}`);
      continue;
    }
    try {
      // Resolved per row, not once for the batch: round-robin has to advance
      // between rows or every contact in the import lands on one person.
      const ownerId = await resolveLeadOwner(orgId, { sourceKey: "csv", actorId: null });
      const rowProvenance = { ...provenance, ...(ownerId ? { ownerId } : {}) };
      if (email) {
        await prisma.lead.upsert({
          where: { organizationId_email: { organizationId: orgId, email } },
          create: { ...(lead as object), organizationId: orgId, ...rowProvenance, custom } as never,
          update: { ...(lead as object), custom } as never,
        });
      } else {
        // LinkedIn-only contact — dedupe on the profile URL.
        const existing = await prisma.lead.findFirst({ where: { organizationId: orgId, linkedinUrl } });
        if (existing) {
          await prisma.lead.update({ where: { id: existing.id }, data: { ...(lead as object), custom } as never });
        } else {
          await prisma.lead.create({ data: { ...(lead as object), organizationId: orgId, ...rowProvenance, custom } as never });
        }
      }
      results.imported++;
    } catch (e) {
      results.skipped++;
      results.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (results.imported > 0) {
    invalidate("leads:");
    invalidate("stats");
  }
  return ok(results);
}
