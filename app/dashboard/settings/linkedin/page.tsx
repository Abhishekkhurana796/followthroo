import { redirect } from "next/navigation";

/**
 * LinkedIn had two screens for one subject — this one and /dashboard/linkedin —
 * which meant the account lived in one place, the limits in another, and the
 * queue counters in a third. They are one screen now.
 *
 * The redirect stays because Settings links here, the profile menu links here,
 * and so does anything a customer bookmarked.
 */
export default function Page() {
  redirect("/dashboard/linkedin");
}
