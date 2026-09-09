/**
 * The assignment rule vocabulary — names and labels only.
 *
 * Deliberately free of any import. Settings → Sources is a client component, and
 * pulling these from lib/assignment.ts dragged prisma → lib/db-encryption →
 * node:crypto into the browser bundle, which fails the build (and would be a
 * bad idea if it did not). Same split as lib/access-control.ts: the shared
 * vocabulary lives where both sides can reach it, the behaviour does not.
 */
export const ASSIGNMENT_RULES = ["manual", "round_robin", "workload", "fixed"] as const;
export type AssignmentRule = (typeof ASSIGNMENT_RULES)[number];

export const ASSIGNMENT_RULE_LABELS: Record<AssignmentRule, { label: string; hint: string }> = {
  manual: {
    label: "Leave unassigned",
    hint: "Contacts wait in the Unassigned view until someone picks them up.",
  },
  round_robin: {
    label: "Round-robin",
    hint: "Rotate evenly through the team, one contact each in turn.",
  },
  workload: {
    label: "Whoever has fewest",
    hint: "Goes to the person with the smallest open book right now.",
  },
  fixed: {
    label: "Always one person",
    hint: "Everything from this source goes to the same rep.",
  },
};
