import { redirect } from "next/navigation";
import { getServerTenant } from "@/lib/tenant";
import { canManageWorkspace } from "@/lib/roles";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

/**
 * Server-side gate. TeamClient has its own `canManage` check, but that only
 * decides which buttons render — a plain member still received the full roster,
 * including everyone's department and reporting line, in the page payload.
 * Whether you can see the org chart is not a styling decision.
 */
export default async function Page() {
  const tenant = await getServerTenant();
  if (!tenant) redirect("/sign-in?redirect=/dashboard/settings/team");
  if (!canManageWorkspace(tenant.role)) redirect("/dashboard/settings");
  return <TeamClient />;
}
