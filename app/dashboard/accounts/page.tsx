import { SWRConfig } from "swr";
import AccountsClient from "./AccountsClient";
import { getSendingAccounts, getSendingDomains } from "@/lib/queries";
import { getServerTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const [accounts, domains] = await Promise.all([
    tenant ? getSendingAccounts(tenant).catch(() => []) : [],
    tenant ? getSendingDomains(tenant.orgId).catch(() => ({ available: false, domains: [] })) : { available: false, domains: [] },
  ]);
  return (
    <SWRConfig
      value={{ fallback: { "/api/sending-accounts": accounts, "/api/domains": domains } }}
    >
      <AccountsClient />
    </SWRConfig>
  );
}
