import { SWRConfig } from "swr";
import { notFound } from "next/navigation";
import LeadDetailClient from "./LeadDetailClient";
import { getLeadDetail, getLeadTimeline } from "@/lib/queries";
import { getServerTenant } from "@/lib/tenant";
import { leadScope } from "@/lib/scope";

// Server Component: the record and its timeline are fetched here, beside the DB,
// and handed down as SWR fallback. Keys must match the client's fetch URLs exactly.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getServerTenant();
  if (!tenant) notFound();

  const scope = await leadScope(tenant);
  const [lead, timeline] = await Promise.all([
    getLeadDetail(tenant.orgId, id, scope.where).catch(() => null),
    getLeadTimeline(tenant.orgId, id, 100, scope.where).catch(() => []),
  ]);
  if (!lead) notFound();

  return (
    <SWRConfig
      value={{
        fallback: {
          [`/api/leads/${id}`]: lead,
          [`/api/leads/${id}/timeline`]: timeline,
        },
      }}
    >
      <LeadDetailClient id={id} />
    </SWRConfig>
  );
}
