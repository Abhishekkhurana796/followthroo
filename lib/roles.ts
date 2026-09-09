/**
 * The four roles, in one place.
 *
 * The database keys are historical and stay as they are — renaming a column
 * value across a live table buys nothing. What was scattered is the *vocabulary*:
 * the Team screen said "Group leader", the docs said "viewer" (a role that has
 * never existed), and nothing said what any of them could actually do. This is
 * the single source for the label and the capability list.
 */
export const ROLES = ["owner", "admin", "group_leader", "member"] as const;
export type Role = (typeof ROLES)[number];

export interface RoleInfo {
  key: Role;
  /** What a person is called in the UI. */
  label: string;
  /** One line, for the picker. */
  description: string;
  /** Can configure the workspace: mailboxes, campaigns, pipelines, domains. */
  manages: boolean;
  /** Sees the whole workspace's data rather than a scoped slice. */
  seesEverything: boolean;
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  owner: {
    key: "owner",
    label: "Owner",
    description: "Full control, including billing. There is exactly one.",
    manages: true,
    seesEverything: true,
  },
  admin: {
    key: "admin",
    label: "Admin",
    description: "Manages the workspace, its mailboxes and everyone in it.",
    manages: true,
    seesEverything: true,
  },
  group_leader: {
    key: "group_leader",
    label: "Manager",
    description: "Sees and assigns work across their department.",
    manages: false,
    seesEverything: false,
  },
  member: {
    key: "member",
    label: "Team member",
    description: "Sees the contacts assigned to them and the ones they added.",
    manages: false,
    seesEverything: false,
  },
};

/** Roles an admin may hand out. Nobody assigns `owner` — it transfers, it is not granted. */
export const ASSIGNABLE_ROLES: Role[] = ["member", "group_leader", "admin"];

export function roleLabel(role: string): string {
  return ROLE_INFO[role as Role]?.label ?? role;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Owner/admin — the two that may change workspace configuration. */
export function canManageWorkspace(role: string): boolean {
  return ROLE_INFO[role as Role]?.manages ?? false;
}

/** Owner/admin — the two whose data views are not narrowed. */
export function seesEverything(role: string): boolean {
  return ROLE_INFO[role as Role]?.seesEverything ?? false;
}
