"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { Input, Skeleton } from "@/components/ui";
import { LEAD_PICKER_PAGE_SIZE, leadPickerKey } from "@/lib/lead-picker-key";

/**
 * Pick one lead from a searchable, paginated list.
 *
 * Every screen that needed this previously hand-rolled it, and each got it
 * slightly wrong. The Test emails page loaded a flat `pageSize=200` with no
 * search, so lead 201 was unreachable — which is exactly how a contact that had
 * been re-added (an upsert, so `createdAt` never moved) became invisible at
 * position 289. The picker in TaskDialog read an envelope the API has never
 * returned, so it was permanently empty.
 *
 * One component, one envelope, one behaviour.
 */

export { LEAD_PICKER_PAGE_SIZE, leadPickerKey };

export type PickerLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
};

type LeadsResponse = {
  items: PickerLead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * A lead can have no name and no company (LinkedIn-only rows allow a null
 * email too), and the old list rendered those as a literal "null · null" — a
 * checkbox with a blank label that looked like a rendering bug. Never return an
 * empty string.
 */
export function leadLabel(l: PickerLead): string {
  const name = [l.firstName, l.lastName].filter(Boolean).join(" ").trim();
  return name || l.email || l.company || "Unnamed lead";
}

/** The quieter second line. Empty when it would just repeat the label. */
export function leadSubLabel(l: PickerLead): string | null {
  const name = [l.firstName, l.lastName].filter(Boolean).join(" ").trim();
  const parts = [name ? l.email : null, l.company].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : null;
}

export function LeadPicker({
  value,
  onChange,
  /** Restrict to leads that actually have an address — a screen that emails cannot use the rest. */
  emailOnly = false,
  heightClass = "max-h-[360px]",
}: {
  value: string | null;
  onChange: (leadId: string | null, lead: PickerLead | null) => void;
  emailOnly?: boolean;
  heightClass?: string;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);

  // 300ms, matching the Leads table. Typing always returns to page 1 — staying
  // on page 7 of a new result set shows an empty list and reads as "no matches".
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const key = useMemo(
    () => leadPickerKey({ page, q: debounced, emailOnly }),
    [page, debounced, emailOnly]
  );
  const { data, isLoading } = useSWR<LeadsResponse>(key);

  const leads = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const searching = debounced.trim().length > 0;

  return (
    <div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or company"
          className="!pl-9"
          aria-label="Search leads"
        />
      </div>

      <div className={`mt-3 space-y-1 overflow-y-auto ${heightClass}`} role="radiogroup" aria-label="Choose a lead">
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}

        {!isLoading && leads.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-ink-soft">
            {searching ? `Nothing matches “${debounced.trim()}”.` : "No leads yet. Add some first."}
          </p>
        )}

        {!isLoading &&
          leads.map((l) => {
            const sub = leadSubLabel(l);
            return (
              <label
                key={l.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                  value === l.id ? "bg-accent-soft" : "hover:bg-tint"
                }`}
              >
                <input
                  type="radio"
                  name="lead-picker"
                  checked={value === l.id}
                  onChange={() => onChange(l.id, l)}
                  className="shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{leadLabel(l)}</span>
                  {sub && <span className="block truncate text-xs text-ink-soft">{sub}</span>}
                </span>
              </label>
            );
          })}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm text-ink-soft">
          <span className="font-mono text-xs">
            {(page - 1) * LEAD_PICKER_PAGE_SIZE + 1}–
            {Math.min(page * LEAD_PICKER_PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={isLoading || page <= 1}
              className="rounded-lg border border-line px-2.5 py-1 text-xs transition hover:bg-tint disabled:opacity-40"
            >
              Prev
            </button>
            <span className="font-mono text-xs">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={isLoading || page >= totalPages}
              className="rounded-lg border border-line px-2.5 py-1 text-xs transition hover:bg-tint disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
