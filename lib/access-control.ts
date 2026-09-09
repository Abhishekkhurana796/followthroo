/**
 * The organization plugin's access-control statement and role set.
 *
 * Lives in its own module because BOTH sides need it: the server plugin in
 * lib/auth.ts (which validates invites and role changes against it) and the
 * client plugin in lib/auth-client.ts (which derives its request types from it).
 * Configure only the server and `group_leader` is rejected at runtime; configure
 * only the client and it is rejected at compile time. It has to be both, from
 * one definition.
 *
 * Deliberately free of any server-only import — this file is bundled into the
 * browser via auth-client.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";

/** better-auth's own resource list. We add no resources, only a fourth role. */
export const ac = createAccessControl(defaultStatements);

export const ownerRole = ac.newRole(ownerAc.statements);
export const adminRole = ac.newRole(adminAc.statements);
export const memberRole = ac.newRole(memberAc.statements);

/**
 * Manager — a member who can also bring people into their department. Everything
 * else about what they see is enforced by department scoping (lib/scope.ts),
 * not by these statements.
 */
export const groupLeaderRole = ac.newRole({
  ...memberAc.statements,
  invitation: ["create"],
});

export const orgRoles = {
  owner: ownerRole,
  admin: adminRole,
  group_leader: groupLeaderRole,
  member: memberRole,
};
