import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getServerTenant } from "@/lib/tenant";
import { getOnboardingState } from "@/lib/queries";
import { billingEnforced } from "@/lib/billing/limits";
import { startTrialIfWaiting } from "@/lib/billing/subscription";

// Onboarding state is read here, on the server, so the tour is either in the
// first paint or absent entirely — never fetched client-side and flashed in.
// `getServerTenant` is React-cache'd, so the page below re-uses this lookup.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getServerTenant();

  // A launch trial's 14 days start the first time somebody opens the workspace
  // after billing goes live — and opening it is this. Before the first paint,
  // so the banner and the chip already show the trial counting.
  if (tenant && billingEnforced()) await startTrialIfWaiting(tenant.orgId).catch(() => {});

  const onboarding = tenant ? await getOnboardingState(tenant.userId).catch(() => null) : null;

  return <DashboardShell onboarding={onboarding}>{children}</DashboardShell>;
}
