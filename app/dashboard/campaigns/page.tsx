import { SWRConfig } from "swr";
import CampaignsClient from "./CampaignsClient";
import { getCampaigns, getTemplates, getSendingAccounts, getSegments } from "@/lib/queries";
import { getServerTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const [campaigns, templates, accounts, segments] = tenant
    ? await Promise.all([
        getCampaigns(tenant.orgId).catch(() => []),
        getTemplates(tenant.orgId).catch(() => []),
        getSendingAccounts(tenant).catch(() => []),
        getSegments(tenant.orgId).catch(() => []),
      ])
    : [[], [], [], []];
  return (
    <SWRConfig
      value={{
        fallback: {
          "/api/campaigns": campaigns,
          "/api/templates": templates,
          "/api/sending-accounts": accounts,
          "/api/segments": segments,
        },
      }}
    >
      <CampaignsClient />
    </SWRConfig>
  );
}
