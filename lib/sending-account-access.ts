import type { Prisma } from "@prisma/client";
import type { TenantContext } from "./tenant";
import { seesEverything } from "./roles";

/**
 * A mailbox is an individual sending identity. Workspace owners can administer
 * all mailboxes, while a teammate may only see or select the account they
 * connected themselves. Legacy accounts have no creator and remain owner/admin
 * managed until their owner reconnects them.
 */
export function sendingAccountWhere(ctx: TenantContext): Prisma.SendingAccountWhereInput {
  return {
    organizationId: ctx.orgId,
    ...(seesEverything(ctx.role) ? {} : { createdById: ctx.userId }),
  };
}

export function canUseSendingAccountWhere(ctx: TenantContext, id: string): Prisma.SendingAccountWhereInput {
  return { id, ...sendingAccountWhere(ctx) };
}
