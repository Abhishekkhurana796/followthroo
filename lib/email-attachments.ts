import { get } from "@vercel/blob";
import { z } from "zod";

export const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENTS = 5;

export const EmailAttachmentSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive().max(MAX_EMAIL_ATTACHMENT_BYTES),
});
export const EmailAttachmentsSchema = z.array(EmailAttachmentSchema).max(MAX_EMAIL_ATTACHMENTS);
export type EmailAttachment = z.infer<typeof EmailAttachmentSchema>;

/** Treat malformed legacy JSON as no attachment, never as a broken send. */
export function readEmailAttachments(value: unknown): EmailAttachment[] {
  return EmailAttachmentsSchema.safeParse(value).data ?? [];
}

/** Fetches the private bytes only in the server-side send path. */
export async function loadEmailAttachments(attachments: EmailAttachment[]) {
  const loaded: { filename: string; contentType: string; content: Buffer }[] = [];
  for (const attachment of attachments) {
    const blob = await get(attachment.url, { access: "private" });
    if (!blob) throw new Error(`Attachment is no longer available: ${attachment.name}`);
    if (!blob.stream) throw new Error(`Attachment has no readable content: ${attachment.name}`);
    const content = Buffer.from(await new Response(blob.stream).arrayBuffer());
    if (content.length > MAX_EMAIL_ATTACHMENT_BYTES) throw new Error(`Attachment is too large: ${attachment.name}`);
    loaded.push({ filename: attachment.name, contentType: attachment.contentType, content });
  }
  return loaded;
}
