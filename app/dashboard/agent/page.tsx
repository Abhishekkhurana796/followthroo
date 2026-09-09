import { SWRConfig } from "swr";
import AgentClient from "./AgentClient";
import { getLeadsPage, getSendingAccounts } from "@/lib/queries";
import { getServerTenant } from "@/lib/tenant";
import { LEAD_PICKER_PAGE_SIZE, leadPickerKey } from "@/lib/lead-picker-key";

export const dynamic = "force-dynamic";

const EMPTY_LEADS = { items: [], total: 0, page: 1, pageSize: LEAD_PICKER_PAGE_SIZE, totalPages: 1 };

export default async function Page() {
  const tenant = await getServerTenant();
  const [leads, accounts] = tenant
    ? await Promise.all([
        // Only leads with an address — this screen sends email.
        getLeadsPage(tenant.orgId, 1, LEAD_PICKER_PAGE_SIZE, undefined, "email").catch(() => EMPTY_LEADS),
        getSendingAccounts(tenant.orgId).catch(() => []),
      ])
    : [EMPTY_LEADS, []];

  return (
    <SWRConfig
      value={{
        fallback: {
          // Built from the same helper the picker uses. Hand-writing this string
          // is how a fallback silently stops matching and every visit refetches.
          [leadPickerKey({ page: 1, emailOnly: true })]: leads,
          "/api/sending-accounts": accounts,
        },
      }}
    >
      <AgentClient />
    </SWRConfig>
  );
}
