import { SWRConfig } from "swr";
import InboxClient from "./InboxClient";
import { getInboxThreads } from "@/lib/queries";
import { getServerTenant } from "@/lib/tenant";
import { leadScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const scope = tenant ? await leadScope(tenant) : null;
  const threads = tenant ? await getInboxThreads(tenant.orgId, undefined, scope?.where).catch(() => []) : [];
  return (
    <SWRConfig value={{ fallback: { "/api/inbox": threads } }}>
      <InboxClient />
    </SWRConfig>
  );
}
