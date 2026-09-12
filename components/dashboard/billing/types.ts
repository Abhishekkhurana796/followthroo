import type { BillingSummary, HistoryEntry } from "@/lib/billing/summary";

/** A server type as it arrives over JSON: dates become strings. */
type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export type Summary = Wire<BillingSummary>;
export type HistoryPage = { entries: Wire<HistoryEntry>[]; next: string | null };

/** One SWR key, so the chip, the banner, the profile badge and Billing share one request. */
export const SUMMARY_KEY = "/api/billing/summary";
