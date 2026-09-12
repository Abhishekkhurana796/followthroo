import { SWRConfig } from "swr";
import DeliverabilityClient from "./DeliverabilityClient";
import { getDeliverability } from "@/lib/deliverability";
import { getServerTenant } from "@/lib/tenant";
import { AnalyzeNav } from "@/components/dashboard/AnalyzeNav";
import { PlanUpsell } from "@/components/dashboard/PlanUpsell";
import { upgradeFor } from "@/lib/billing/limits";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const upgrade = tenant ? await upgradeFor(tenant.orgId, "deliverability") : null;
  if (upgrade) {
    return (
      <>
        <AnalyzeNav />
        <PlanUpsell
          title="Deliverability"
          body="Bounces, complaints, authentication and warm-up for every mailbox, so a reputation problem shows up before it costs you replies."
          {...upgrade}
        />
      </>
    );
  }
  const data = tenant ? await getDeliverability(tenant.orgId, 30).catch(() => null) : null;
  return (
    <SWRConfig value={{ fallback: { "/api/deliverability?days=30": data } }}>
      <AnalyzeNav />
      <DeliverabilityClient />
    </SWRConfig>
  );
}
