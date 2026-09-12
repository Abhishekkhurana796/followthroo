import type { Summary } from "./types";

export const count = (n: number) => n.toLocaleString("en-US");

/** "6h 12m" until a moment, or "a moment" once it's under a minute away. */
export function until(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (mins < 1) return "a moment";
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/**
 * Whether there are credits worth showing: billing is on and the workspace has
 * a plan that can spend. Before launch every workspace would read "0 of 0", and
 * once a plan ends the banner says what matters.
 */
export const spendingPlan = (s: Summary | undefined): s is Summary & { plan: NonNullable<Summary["plan"]> } =>
  !!s?.enforced && !!s.plan && (s.access === "active" || s.access === "trial");
