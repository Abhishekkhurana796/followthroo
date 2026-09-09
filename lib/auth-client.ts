"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient, genericOAuthClient } from "better-auth/client/plugins";
import { ac, orgRoles } from "./access-control";

export const authClient = createAuthClient({
  // Same ac/roles as the server (lib/auth.ts). Without them the client's types
  // only know owner/admin/member, and passing "group_leader" needs an `as any`
  // cast — which is exactly what hid the fact that the server rejected it too.
  plugins: [organizationClient({ ac, roles: orgRoles }), genericOAuthClient()],
});
export const { signIn, signUp, signOut, useSession, organization } = authClient;
