import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, genericOAuth } from "better-auth/plugins";
import { ac, orgRoles } from "./access-control";
import { prisma } from "./db";
import { sendSystemEmail } from "./channels/email";
import { configured } from "./env";
import { authRateLimitStorage } from "./api-ratelimit";
import { roleLabel } from "./roles";
import { APIError } from "better-auth/api";
import { billingEnforced, checkLimit } from "./billing/limits";
import { hasFeature } from "./billing/plans";
import { workspacePlan } from "./billing/subscription";

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
 * Refuse a seat the workspace's plan has no room for. An invitation holds a
 * seat until it's accepted or expires, so a two-person plan can't send five.
 */
async function assertSeatFree(organizationId: string, { invitation }: { invitation: boolean }) {
  if (!billingEnforced()) return;
  const pending = invitation
    ? await prisma.invitation.count({ where: { organizationId, status: "pending", expiresAt: { gt: new Date() } } })
    : 0;
  const check = await checkLimit(organizationId, "users", 1 + pending);
  if (!check.ok) {
    throw new APIError("FORBIDDEN", { message: pending ? `${check.message} Pending invitations hold a seat too.` : check.message });
  }
}

/** The admin and group lead roles are on Grow and Scale. */
async function assertRoleIncluded(organizationId: string, role: string) {
  if (!billingEnforced() || (role !== "admin" && role !== "group_leader")) return;
  const wp = await workspacePlan(organizationId);
  if (wp.plan && hasFeature(wp.plan, "roles")) return;
  throw new APIError("FORBIDDEN", {
    message: `The admin and group lead roles aren't included in ${wp.plan ? `the ${wp.plan.name} plan` : "your workspace yet"}. Upgrade to use them.`,
  });
}

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

/**
 * Whether password sign-ups must confirm their email before signing in.
 *
 * They used to be marked verified on creation, because nothing could send a
 * confirmation. So an address was never proven to belong to whoever typed it —
 * and with Google trusted for account linking, someone could register another
 * person's email with a password of their own, and keep access after the real
 * owner signed in with Google.
 *
 * It needs mail. Without SMTP the link can never arrive, and requiring it would
 * lock every new password sign-up out — so without SMTP the old behaviour stays,
 * and says so loudly every time the server starts.
 */
const verifyEmails = configured.email;
if (!verifyEmails) {
  console.error(
    "[auth] SMTP_HOST / SMTP_USER / SMTP_PASS are not set: password sign-ups are NOT email-verified. Configure SMTP to require confirmation.",
  );
}

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

/**
 * Which workspace a new session should open in.
 *
 * This used to be the OLDEST membership. Every account gets a personal workspace
 * the moment it is created (above), so for anyone who signed up and then accepted
 * an invitation, "oldest" meant that empty personal workspace — not the team they
 * joined. Accepting switched the one session it happened in; every later sign-in
 * dropped them back. Tasks and notifications are scoped to the active workspace,
 * so work assigned to them looked like it had never arrived.
 *
 * Now: the workspace they last switched to, if they still belong to it; otherwise
 * the one they joined most recently, which is the invitation they accepted.
 */
export async function preferredOrganizationId(userId: string): Promise<string | null> {
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { lastActiveOrganizationId: true } }),
    prisma.member.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { organizationId: true } }),
  ]);
  const last = user?.lastActiveOrganizationId;
  if (last && memberships.some((m) => m.organizationId === last)) return last;
  return memberships[0]?.organizationId ?? null;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Signing a brand-new account straight in would skip the confirmation.
    autoSignIn: !verifyEmails,
    requireEmailVerification: verifyEmails,
  },
  emailVerification: {
    sendOnSignUp: verifyEmails,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    async sendVerificationEmail({ user, url }) {
      const sent = await sendSystemEmail(
        user.email,
        "Confirm your email for Followthroo",
        `Confirm your email address

Someone — hopefully you — created a Followthroo account with this address. Confirm it to finish signing up:

${url}

The link works for 24 hours. If you didn't create this account, ignore this email: nothing happens, and nobody can sign in with it.`,
      );
      if (!sent) console.warn(`[auth] verification email not sent to ${user.email}`);
    },
  },
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
      // Never attach a Google login to a password account whose address was never
      // confirmed: whoever set that password may not own the inbox. better-auth's
      // own default today — stated so an upgrade cannot quietly turn it off.
      requireLocalEmailVerified: true,
    },
  },
  // Sign-in, sign-up and verification emails are what gets hammered. better-auth
  // limits them per IP, in memory by default — which on Vercel means per instance,
  // barely a limit — so the counts go to Redis when there is one.
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 3 },
    },
    ...(configured.redis ? { customStorage: authRateLimitStorage } : {}),
  },
  databaseHooks: {
    user: {
      create: {
        // With SMTP, a password sign-up starts unverified and the emailed link
        // verifies it. Without SMTP nothing can, so it keeps the old
        // mark-as-verified (see verifyEmails). OAuth sign-ups carry their
        // provider's verification either way.
        before: async (user) => ({ data: verifyEmails ? user : { ...user, emailVerified: true } }),
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
        // Open each new session in the workspace the person was last working in.
        before: async (session) => ({
          data: { ...session, activeOrganizationId: await preferredOrganizationId(session.userId) },
        }),
      },
      update: {
        // Remember a workspace switch so the next sign-in opens there too. The
        // organization plugin's setActive writes through this same session
        // update, which covers the sidebar switcher and accepting an invitation.
        after: async (session) => {
          const orgId = (session as { activeOrganizationId?: string | null }).activeOrganizationId;
          if (!orgId) return;
          await prisma.user
            .updateMany({
              where: {
                id: session.userId,
                OR: [{ lastActiveOrganizationId: null }, { lastActiveOrganizationId: { not: orgId } }],
              },
              data: { lastActiveOrganizationId: orgId },
            })
            .catch((e) => console.error("[auth] failed to remember the active workspace:", e));
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
                  // Zoho confirms an account's address before it can sign in
                  // anywhere, so a Zoho sign-up is as verified as a Google one.
                  emailVerified: true,
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

      /**
       * Plan limits on people and roles, checked where better-auth adds them:
       * the Team screen talks to better-auth directly, so a check in our own
       * routes would never run. Off until BILLING_ENFORCED=1, like every limit.
       */
      organizationHooks: {
        async beforeCreateInvitation({ invitation, organization }) {
          await assertSeatFree(organization.id, { invitation: true });
          await assertRoleIncluded(organization.id, invitation.role);
        },
        async beforeAddMember({ member, organization }) {
          // A new workspace's creator is added as its owner before it has a plan.
          if (member.role === "owner") return;
          await assertSeatFree(organization.id, { invitation: false });
          await assertRoleIncluded(organization.id, member.role);
        },
        async beforeUpdateMemberRole({ newRole, organization }) {
          await assertRoleIncluded(organization.id, newRole);
        },
      },

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
