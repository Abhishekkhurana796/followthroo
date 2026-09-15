import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { ensureSource } from "@/lib/identity";
import { resolveLeadOwner } from "@/lib/assignment";
import { invalidate } from "@/lib/cache";
import { LIMITS, tooMany } from "@/lib/api-ratelimit";
import { roomFor } from "@/lib/billing/limits";
import { parseCsvRows, parseXlsxRows, type ImportRow } from "@/lib/lead-import-file";

export const runtime = "nodejs";
const MAX_XLSX_BYTES = 10 * 1024 * 1024;

// Known columns map onto lead fields; everything else becomes a custom variable.
// Keep in step with IMPORT_COLUMNS in app/dashboard/leads/LeadsClient.tsx, which
// tells people what this accepts.
const KNOWN = new Set([
  "email", "firstname", "name", "lastname", "phone",
  "linkedinurl", "linkedin", "linkedinprofile", "linkedinprofilelink", "profile", "profilelink", "profileurl",
  "company", "title", "tags",
]);

function normalizeRow(row: ImportRow) {
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
      // Several in one cell, separated by commas or semicolons.
      case "tags": lead.tags = value.split(/[,;]/).map((t) => t.trim()).filter(Boolean); break;
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
  // An import writes hundreds of rows; a script firing them in a loop is the
  // easiest way one member can slow the database for everyone.
  const limited = await tooMany(`import:${ctx.userId}`, LIMITS.heavyWrite);
  if (limited) return limited;
  const { orgId } = ctx;

  const contentType = req.headers.get("content-type") ?? "";
  let rows: ImportRow[];
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return fail("attach an .xlsx file");
      if (!/\.xlsx$/i.test(file.name)) return fail("only .xlsx files are supported for Excel imports");
      if (file.size > MAX_XLSX_BYTES) return fail("Excel files must be 10 MB or smaller");
      rows = parseXlsxRows(await file.arrayBuffer());
    } else {
      const csv = contentType.includes("application/json")
        ? (await req.json().catch(() => null))?.csv
        : await req.text();
      if (typeof csv !== "string" || csv.trim() === "") return fail("empty CSV");
      rows = parseCsvRows(csv);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not read the import file.");
  }

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
  // Lead storage is a plan limit. Updating somebody already here never needs
  // room — only a new contact does. Unlimited, or not enforced yet, is Infinity,
  // which also skips the extra lookup email rows would otherwise need.
  let room = await roomFor(orgId, "leads");
  let overStorage = 0;
  for (const row of rows) {
    const { lead, custom } = normalizeRow(row);
    const email = lead.email as string | undefined;
    const linkedinUrl = lead.linkedinUrl as string | undefined;
    if (!email && !linkedinUrl) {
      results.skipped++;
      results.errors.push(`row needs an email or LinkedIn URL: ${JSON.stringify(row).slice(0, 80)}`);
      continue;
    }
    try {
      // LinkedIn-only contact — dedupe on the profile URL.
      const existingByUrl = email ? null : await prisma.lead.findFirst({ where: { organizationId: orgId, linkedinUrl } });
      const isNew = email
        ? Number.isFinite(room) &&
          !(await prisma.lead.findUnique({ where: { organizationId_email: { organizationId: orgId, email } }, select: { id: true } }))
        : !existingByUrl;
      if (isNew) {
        if (room <= 0) {
          overStorage++;
          results.skipped++;
          continue;
        }
        room--;
      }

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
      } else if (existingByUrl) {
        await prisma.lead.update({ where: { id: existingByUrl.id }, data: { ...(lead as object), custom } as never });
      } else {
        await prisma.lead.create({ data: { ...(lead as object), organizationId: orgId, ...rowProvenance, custom } as never });
      }
      results.imported++;
    } catch (e) {
      results.skipped++;
      results.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (overStorage > 0) {
    results.errors.push(
      `${overStorage} new ${overStorage === 1 ? "contact was" : "contacts were"} not added: your plan's lead storage is full.`,
    );
  }
  if (results.imported > 0) {
    invalidate("leads:");
    invalidate("stats");
  }
  return ok(results);
}
