import EscalationsClient from "./EscalationsClient";
import { AnalyzeNav } from "@/components/dashboard/AnalyzeNav";
import { PlanUpsell } from "@/components/dashboard/PlanUpsell";
import { upgradeFor } from "@/lib/billing/limits";
import { getServerTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const upgrade = tenant ? await upgradeFor(tenant.orgId, "escalations") : null;
  return (
    <>
      <AnalyzeNav />
      {upgrade ? (
        <PlanUpsell
          title="Escalations"
          body="SLA rules that notice when a lead has waited too long and hand it up the chain — rep, group leader, admin."
          {...upgrade}
        />
      ) : (
        <EscalationsClient />
      )}
    </>
  );
}
