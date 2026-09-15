import type { TenantContext } from "../lib/tenant";
import { canUseSendingAccountWhere, sendingAccountWhere } from "../lib/sending-account-access";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const member = { orgId: "org_1", userId: "member_1", role: "member" } as TenantContext;
const owner = { orgId: "org_1", userId: "owner_1", role: "owner" } as TenantContext;

const memberScope = sendingAccountWhere(member);
assert(memberScope.organizationId === "org_1", "member scope must retain tenant");
assert(memberScope.createdById === "member_1", "member scope must require their mailbox owner");

const ownerScope = sendingAccountWhere(owner);
assert(ownerScope.organizationId === "org_1", "owner scope must retain tenant");
assert(ownerScope.createdById === undefined, "owner scope may administer workspace mailboxes");

const selected = canUseSendingAccountWhere(member, "account_1");
assert(selected.id === "account_1" && selected.createdById === "member_1", "selected mailbox must retain member ownership");

console.log("Sending account access: 5/5 checks passed.");
