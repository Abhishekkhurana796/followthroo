import { SWRConfig } from "swr";
import TasksClient from "./TasksClient";
import { getTasks } from "@/lib/queries";
import { getServerTenant } from "@/lib/tenant";
import { taskOwnerScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tenant = await getServerTenant();
  const buckets = tenant
    ? await getTasks(tenant.orgId, undefined, await taskOwnerScope(tenant)).catch(() => null)
    : null;

  return (
    <SWRConfig value={{ fallback: { "/api/tasks?view=buckets": buckets } }}>
      <TasksClient />
    </SWRConfig>
  );
}
