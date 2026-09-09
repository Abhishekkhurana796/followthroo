import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, genericOAuth } from "better-auth/plugins";
import { ac, orgRoles } from "./access-control";
import { prisma } from "./db";
import { sendSystemEmail } from "./channels/email";
import { roleLabel } from "./roles";

/**
 * better-auth — email/password + "Sign in with Google" social login.
 * The Google provider is registered only when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 * are set, so the app still boots without them (the button just won't work).
 * Login callback is handled by better-auth at {baseURL}/api/auth/callback/google
 * — distinct from the gmail.send sending-account flow at /api/auth/google/callback.
 */
const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * "Sign in with Zoho". better-auth has no built-in Zoho provider, so this rides
 * the genericOAuth plugin — its callback is {baseURL}/oauth2/callback/zoho,
 * which is the redirect URI registered in the Zoho API console.
 *
 * Zoho is region-partitioned (see lib/zoho.ts): an Indian account's tokens are
 * only valid against .in endpoints. ZOHO_DC picks the region these sign-in
 * endpoints point at, defaulting to India.
 */
const zohoConfigured = !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
const zohoDc = process.env.ZOHO_DC || "in";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Origins better-auth will accept state-changing requests from (CSRF guard).
 * Auth only ever runs on the app subdomain (followthroo.com is the separate,
 * unauthenticated showcase site — see middleware.ts) so app.followthroo.com is
 * included explicitly alongside whatever NEXT_PUBLIC_APP_URL resolves to, in
 * case that env var lags behind during a domain migration. Extra origins can
 * be supplied via BETTER_AUTH_TRUSTED_ORIGINS (comma-separated).
 */
const trustedOrigins = Array.from(
  new Set(
    [
      baseUrl,
      "https://app.followthroo.com",
      ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()) ?? []),
    ].filter(Boolean)
  )
);

/** Slugify a name/email into a unique-ish org slug. */
function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || "org";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a personal organization for a freshly-created user and make them its owner.
 * Runs in the user.create.after hook so every account has a tenant to scope data into.
 */
async function createPersonalOrg(user: { id: string; name?: string | null; email: string }) {
  const name = user.name?.trim() || user.email.split("@")[0] || "My Workspace";
  const org = await prisma.organization.create({
    data: { name: `${name}'s Workspace`, slug: slugify(name || user.email) },
  });
  await prisma.member.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });
  return org;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, autoSignIn: true },
  ...(googleConfigured
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),
  // Link Google logins to an existing email/password account with the same address.
  // Safe because Google verifies email ownership, so it's a trusted provider.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  // There is no email-verification flow yet, so email/password users would otherwise
  // stay emailVerified:false forever — which blocks later "Sign in with Google" linking
  // (account_not_linked). Mark new users verified on creation until a real verification
  // flow exists. This lowers no security guarantee the app currently makes.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, emailVerified: true } }),
        // Give every new user a personal organization to own and scope data into.
        after: async (user) => {
          await createPersonalOrg(user).catch((e) =>
            console.error("[auth] failed to create personal org:", e)
          );
        },
      },
    },
    session: {
      create: {
        // Attach the user's (first / owned) org as the active tenant on each new session.
        before: async (session) => {
          const member = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
          });
          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    ...(zohoConfigured
      ? [
          genericOAuth({
            config: [
              {
                providerId: "zoho",
                clientId: process.env.ZOHO_CLIENT_ID!,
                clientSecret: process.env.ZOHO_CLIENT_SECRET!,
                authorizationUrl: `https://accounts.zoho.${zohoDc}/oauth/v2/auth`,
                tokenUrl: `https://accounts.zoho.${zohoDc}/oauth/v2/token`,
                userInfoUrl: `https://accounts.zoho.${zohoDc}/oauth/user/info`,
                // Identity only. Permission to SEND as this person is a separate,
                // later consent (/api/auth/zoho/start) — asking for mail access
                // just to sign up would be the wrong trade for a new user.
                scopes: ["email", "profile", "AaaServer.profile.READ"],
                authorizationUrlParams: { access_type: "offline", prompt: "consent" },
                mapProfileToUser: (profile: Record<string, unknown>) => ({
                  email: String(profile.Email ?? profile.email ?? ""),
                  name: String(profile.Display_Name ?? profile.displayName ?? profile.First_Name ?? ""),
                }),
              },
            ],
          }),
        ]
      : []),
    organization({
      /**
       * better-auth validates every invite and role change against the roles it
       * knows about, which by default are owner/admin/member only. `group_leader`
       * is a fourth value on the same column, so without registering it here the
       * plugin threw "Role not found: group_leader" at runtime — while the Team
       * screen happily offered it in both dropdowns and an `as any` cast kept the
       * type checker quiet. Selecting Manager simply failed.
       *
       * A group leader gets a member's permissions plus the ability to invite,
       * which is what running a department actually requires.
       */
      ac,
      roles: orgRoles,

      async sendInvitationEmail(data) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const url = `${appUrl}/accept-invitation/${data.id}`;
        const org = data.organization.name;
        const inviter = data.inviter?.user?.name || data.inviter?.user?.email || "A teammate";
        const role = roleLabel(data.role ?? "member");

        const sent = await sendSystemEmail(
          data.email,
          `${inviter} invited you to ${org} on Followthroo`,
          `You've been invited to Followthroo

` +
            `${inviter} has invited you to join ${org}'s outreach workspace as a ${role}.

` +
            `Accept the invitation: ${url}

` +
            `If you weren't expecting this, you can ignore this email — the invitation ` +
            `expires on its own and nothing happens until you accept it.`
        );

        // The Team screen still shows a copy-link button, which is the fallback
        // when mail is not configured or the address bounces. Log either way so a
        // failed invite is diagnosable rather than invisible.
        if (!sent) console.warn(`[auth] invitation email not sent to ${data.email}; share the link instead: ${url}`);
      },
    }),
  ],
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: baseUrl,
  trustedOrigins,
});
