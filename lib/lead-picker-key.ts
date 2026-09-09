/**
 * The SWR key for a page of the lead picker.
 *
 * Deliberately in its own module with no "use client": both the picker (client)
 * and the page that seeds its SWR fallback (server) have to produce a
 * byte-identical string, and importing a client module from a server component
 * is a runtime error. Hand-writing the string in two places is how a fallback
 * silently stops matching and every visit refetches on mount.
 */
export const LEAD_PICKER_PAGE_SIZE = 25;

export function leadPickerKey(opts: { page: number; q?: string; emailOnly?: boolean }): string {
  const params = new URLSearchParams({
    page: String(opts.page),
    pageSize: String(LEAD_PICKER_PAGE_SIZE),
  });
  // Only send `book` when filtering, so the unfiltered key stays stable.
  if (opts.emailOnly) params.set("book", "email");
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  return `/api/leads?${params}`;
}
