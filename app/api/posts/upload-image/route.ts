import { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { ok, fail } from "@/lib/http";
import { requireOrg } from "@/lib/tenant";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/posts/upload-image — a customer-supplied image for a post,
 * stored in Vercel Blob and later re-uploaded to LinkedIn at publish time
 * (lib/linkedin/post.ts fetches this URL server-side). multipart/form-data,
 * field name "file".
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;

  if (!process.env.BLOB_READ_WRITE_TOKEN) return fail("Image storage isn't configured on this deployment.", 503);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Attach an image as \"file\".", 422);
  if (!ALLOWED.has(file.type)) return fail("JPEG, PNG or WebP only.", 422);
  if (file.size > MAX_BYTES) return fail("Images are limited to 8MB.", 422);

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const pathname = `posts/${ctx.orgId}/${Date.now()}.${ext}`;
  const blob = await put(pathname, file, { access: "public", contentType: file.type });
  return ok({ url: blob.url });
}
