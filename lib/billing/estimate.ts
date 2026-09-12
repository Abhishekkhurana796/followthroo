/**
 * What enrolling one lead in a campaign can cost, in credits — for the
 * confirmation before launching. Pure, so the browser runs it on the sequence
 * it already has.
 *
 * An upper bound, not a forecast. A condition sends one branch or the other, a
 * lead who replies stops early, and an invitation only costs 5 if it carries a
 * note. This assumes every send step runs at its highest price; credits are only
 * taken as each step actually goes out.
 */
import { CREDIT_COSTS } from "./plans";

type RawStep = { type?: string; channel?: string; linkedinAction?: string | null; noteFor?: string | null };

function stepCost(step: RawStep) {
  switch (step.channel) {
    case "email":
      return CREDIT_COSTS.email_send;
    case "whatsapp":
      return CREDIT_COSTS.whatsapp_send;
    case "linkedin":
      if (step.linkedinAction === "message") return CREDIT_COSTS.li_message;
      return step.noteFor === "none" ? CREDIT_COSTS.li_invite : CREDIT_COSTS.li_invite_note;
    default:
      return 0;
  }
}

/** The most one lead can cost across a whole sequence, legacy list or node graph. */
export function creditsPerLead(sequence: unknown): number {
  const steps: RawStep[] = Array.isArray(sequence)
    ? (sequence as RawStep[])
    : (((sequence as { nodes?: RawStep[] } | null)?.nodes ?? []) as RawStep[]).filter((n) => n.type === "send");
  return steps.reduce((sum, step) => sum + stepCost(step), 0);
}
