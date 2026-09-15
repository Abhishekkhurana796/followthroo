import type { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";
import { MAX_EMAIL_ATTACHMENT_BYTES } from "@/lib/email-attachments";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "application/pdf", "text/plain", "text/csv", "application/zip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg", "image/png", "image/webp",
]);

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180) || "attachment";

/** Upload one email-template attachment as a private Blob. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fail("Attachment storage isn't configured on this deployment.", 503);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Attach a file in the \"file\" field.", 422);
  if (!ALLOWED.has(file.type)) return fail("Use a PDF, Office document, ZIP, CSV, text file, or JPEG/PNG/WebP image.", 422);
  if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) return fail("Attachments are limited to 10MB each.", 422);

  const name = safeName(file.name);
  const blob = await put(`template-attachments/${ctx.orgId}/${crypto.randomUUID()}-${name}`, file, {
    access: "private",
    contentType: file.type,
  });
  return ok({ attachment: { url: blob.url, name, contentType: file.type, size: file.size } });
}
