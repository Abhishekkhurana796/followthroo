import AgeingClient from "./AgeingClient";
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
          title="Ageing"
          body="Which leads have sat in a stage too long, by stage and by owner, so nothing quietly goes cold."
          {...upgrade}
        />
      ) : (
        <AgeingClient />
      )}
    </>
  );
}
