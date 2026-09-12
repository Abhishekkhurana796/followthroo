import ControlTowerClient from "./ControlTowerClient";
import { AnalyzeNav } from "@/components/dashboard/AnalyzeNav";
import { PlanUpsell } from "@/components/dashboard/PlanUpsell";
import { upgradeFor } from "@/lib/billing/limits";
import { getServerTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const upgrade = tenant ? await upgradeFor(tenant.orgId, "team_reports") : null;
  return (
    <>
      <AnalyzeNav />
      {upgrade ? (
        <PlanUpsell
          title="Control tower"
          body="Every open conversation across the team on one screen, with the ones still waiting on a reply first."
          {...upgrade}
        />
      ) : (
        <ControlTowerClient />
      )}
    </>
  );
}
