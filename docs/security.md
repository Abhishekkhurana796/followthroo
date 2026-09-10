# security.md — Auth, Secrets, Encryption, Compliance

**Last updated:** 2026-09-10
**Status:** needs-review

> No secrets in source, logs, or client code. Least privilege everywhere. Consent and
> opt-out are non-negotiable.

---

## What is in place (2026-09-10)

A summary for anyone asking "is our data safe?". Each line is described in more detail
below, and points at the code that does it.

| Layer | Measure |
|---|---|
| Sign-in | better-auth sessions in HTTP-only cookies; password sign-ups confirm their email; sign-in, sign-up and verification emails rate-limited |
| Every API route | `requireOrg` (session) or a signed/keyed credential; nothing is anonymous except tracking pixels and Meta's webhook challenge |
| Tenancy | every query scoped to `organizationId`; within a workspace, members see — and can change — only their own contacts, threads and tasks (`lib/scope.ts`) |
| Credentials at rest | mailbox passwords, OAuth tokens, DKIM keys, LinkedIn tokens: AES-256-GCM, key outside the database |
| Database | not reachable through Supabase's public API: row-level security on every table, and the public roles hold no privileges (`scripts/lockdown-supabase-roles.ts`) |
| Abuse | per-token, per-key, per-member and per-IP request limits on our own API (`lib/api-ratelimit.ts`), on top of the outbound channel quotas (`lib/ratelimit.ts`) |
| Browser | HSTS, no MIME sniffing, no framing by other sites, strict referrer, no camera/mic/location (`next.config.ts`) |
| Lists | paginated or explicitly capped; reports aggregate in the database |

## Authentication

**User login (our app).** better-auth (`lib/auth.ts`): email and password, Google, and
Zoho, with its organization plugin for workspaces and roles. Sessions live in HTTP-only
cookies; `middleware.ts` redirects signed-out visitors away from `/dashboard`, and every
route handler re-checks the session with `requireOrg`.

**Email confirmation.** A password sign-up is created unverified and cannot sign in
until the emailed link is opened (`emailAndPassword.requireEmailVerification`). Until
2026-09-10 every sign-up was marked verified on creation, because nothing could send a
confirmation — so an address was never proven to belong to whoever typed it. With Google
trusted for account linking, that let someone register another person's email with a
password of their own and keep access after the real owner signed in with Google.
`accountLinking.requireLocalEmailVerified` is set explicitly so a Google login is never
attached to an unconfirmed password account.

Confirmation needs mail. Without `SMTP_HOST/USER/PASS` the link could never arrive, so
the old behaviour stays and the server logs an error on every start. **Set SMTP in
production.** Accounts created before the change stay verified. Residual gap: an
unconfirmed account holds its address until someone confirms it; the email tells a
recipient who did not sign up to ignore it.

**Rate limits on auth.** better-auth's own limiter, per IP: sign-in 10/min, sign-up
5/min, verification emails 3/min, everything else 100/min. Counts live in Redis when
`REDIS_URL` is set (`authRateLimitStorage`); in memory they are per Vercel instance and
barely a limit.

**Per-service auth (outbound).**
- **Gmail/Google:** OAuth2 with refresh tokens, encrypted at rest; or SMTP with app
  passwords. Minimal scopes.
- **LinkedIn:** OAuth2 for identity and posting; the extension and desktop app use a
  per-member pairing token (`LinkedInAccount.extToken`), rotatable from the LinkedIn screen.
- **Twilio/WhatsApp:** scoped API keys, stored encrypted.
- **Webhooks and cron:** HMAC or shared-secret signatures, compared in constant time
  (`lib/webhook-auth.ts`, `lib/cron-auth.ts`); inbound lead webhooks use a per-workspace
  ingest key.

## Access control (RBAC)
- Roles, as actually implemented on `Member.role` (see `lib/tenant.ts`):
  `owner`, `admin`, `group_leader` (shown as **Manager**), `member` (**Team member**).
  There is no `viewer`.
- Two orthogonal axes: **role** gates what you can configure (`requireRole`),
  **department** gates what data you can see (`isDepartmentScoped`,
  `requireDepartmentAccess`). A member with no department sees nothing
  department-scoped — fail closed, not fail open.
- **Contact scope** (`lib/scope.ts`): owners and admins see the workspace; managers see
  their department; members see contacts assigned to or added by them. The same rule
  applies to writes. Until 2026-09-10 `PATCH`/`DELETE /api/leads/[id]` checked only the
  workspace, so a member could edit or erase a colleague's contact by id; the Inbox thread
  routes had the same gap. Out-of-scope reads and writes answer "not found".
- Creating or deleting a mailbox, and creating, editing or deleting a campaign, require
  `owner`/`admin`. Reading stays open to members, who need it to work.
- Enforce on every API route; there are no server actions in this codebase, so
  `requireOrg` in the route handler is the single write-side chokepoint.

## Database exposure

The database is Supabase Postgres. Supabase publishes the `public` schema through its
REST Data API to two roles, `anon` (anyone holding the project's anon key) and
`authenticated`. The app never uses that API or those roles: Prisma connects as the table
owner, which bypasses row-level security.

As checked on 2026-09-10: row-level security was already on for all 39 tables with no
policies, so the Data API returned nothing. But both public roles still held every
privilege on every table, and the schema's default privileges granted them the same on
any future table — which `prisma db push` creates with row-level security **off**.
`scripts/lockdown-supabase-roles.ts --yes` revoked those privileges, removed them from the
defaults, and enables row-level security on any table that lacks it. **Run it (report
mode is the default) after any schema change that adds a table.**

Not encrypted, on purpose: `Lead.email` (unique-constrained and searched; a blind index
there would touch the identity graph, CSV import and reply matching) and
`Account.password` (already a one-way scrypt hash).

## Rate limiting our own API

`lib/ratelimit.ts` limits what the product *sends*. `lib/api-ratelimit.ts` limits what it
*receives* — fixed windows in Redis, raced against a 250 ms timeout, failing **open** so
the limiter can never take the API down with it:

| What | Keyed on | Limit |
|---|---|---|
| Extension and desktop app (every route via `requireExtAuth`) | pairing token | 120/min |
| Inbound lead webhooks | source + workspace | 300/min |
| Email and WhatsApp provider webhooks | caller IP | 300/min |
| CSV import, bulk lead edits | member | 20/min |
| Open/click tracking | caller IP | 600/min — over it, the pixel and the redirect still work; nothing is recorded |

A limited request gets `429` with `Retry-After`.

## Pagination and bounded queries
- Leads: paged (`pageSize` ≤ 500); malformed paging parameters fall back to defaults
  instead of failing.
- Inbox: 50 threads a page with "Load older" (it used to stop at 100 with no way past).
- Outbox: 50 a page, cursor-paged.
- Tasks: 200 per section; a full section says so on screen.
- Lead timeline: paged separately from the lead record.
- Reports: totals, daily series and per-campaign numbers are aggregated in the database.
  They used to load every message and event in the window into memory.

## Web app hardening
- Security headers on every response (`next.config.ts`): HSTS, `nosniff`,
  `strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, a restrictive
  Permissions-Policy, and a report-only CSP to tighten from.
- better-auth's CSRF check through `trustedOrigins`; framework auto-escaping; inputs
  validated with zod at the route.
- CORS is open only on the extension routes, which authenticate with a bearer token and
  never with cookies.
- The click tracker redirects only to URLs the message itself contained (signed links),
  so it is not an open redirect.

## Secrets management (OWASP-aligned)
- Store all credentials in **env vars / a vault** — never in the repo.
- **Least privilege:** not every service gets every key.
- **Automated rotation**; log access to secret operations.
- Centralize + audit — scattered secrets in code/config are the top leak source.
- `.env.example` documents required keys with placeholder values only.

## Data protection
- **Encrypt credentials at rest** (see below).
- **TLS/HTTPS** for all traffic.
- **Never** put PII or API keys in logs or client-side bundles.
- Encrypted, regular database backups.

## Monitoring & alerting
- Structured audit log of every outreach action (sent / delivered / clicked / bounced).
- Alerts on: bounce/spam spikes, unusual send rates, server errors, secret-access
  anomalies. Auto-pause campaigns on threshold breach (see [rate-limits.md](rate-limits.md)).

## Compliance (GDPR & channel consent)
- **Consent** before contacting (explicit opt-in required for WhatsApp).
- **Unsubscribe** in every email; global suppression list honored across channels.
- **Right to deletion** — `DELETE /api/leads/[id]` erases a contact and records the
  suppression on the compliance ledger.
- Maintain an **audit trail** of actions for accountability.

## Credentials at rest

`SendingAccount.pass`, `refreshToken` and `dkimPrivateKey`, and better-auth's
`Account.accessToken` / `refreshToken` / `idToken`, are encrypted with
**AES-256-GCM** before they reach the database.

How it works:

- `lib/crypto.ts` holds the primitives. Ciphertext is
  `<keyId>.<iv>.<tag>.<ciphertext>`, base64url. The leading key id is what makes
  rotation a redeploy rather than an outage — an old row keeps naming the key
  that can still open it.
- `lib/db-encryption.ts` applies it as a **Prisma client extension**, so
  encryption is a property of the client rather than a rule each call site has
  to remember. That is also the only way to cover better-auth's `prismaAdapter`,
  which writes the `Account` token columns itself.
- Keys live in `ENCRYPTION_KEYS` (`v1:<base64 32 bytes>,v2:…`), outside the
  database, different per environment. With none set the app **refuses to store
  a credential** rather than silently writing plaintext.
- A value without the `v<n>.` envelope is treated as legacy plaintext and
  returned unchanged, so a deploy can precede the backfill.
  `scripts/encrypt-backfill.ts` clears the plaintext out, and `--rotate`
  re-encrypts under a new key. Run order matters and the script enforces it —
  set the key, deploy, *then* backfill.

The AAD is `model:column`, deliberately **not** including `organizationId`: a
Prisma `update({ where: { id }, data: { pass } })` carries no org id, so binding
to a tenant would make writes and reads disagree on the AAD and the row would
stop opening. Column binding survives every code path. Tenant isolation is
enforced by the `organizationId` scoping in `lib/tenant.ts`, not by the cipher.

Reads are also projected: every list route uses `SEND_ACCOUNT_SELECT`
(`lib/queries.ts`) and campaigns share `CAMPAIGN_INCLUDE`, so a sending account's
secret columns cannot reach a browser. Three `include: { sendingAccount: true }`
call sites previously bypassed that and served the plaintext SMTP password into
the RSC payload of `/dashboard/campaigns`; that is what the shared constant now
prevents.

## Task assignment

`Task.ownerId` is a raw userId with no foreign key, by design — org memberships
change and a hard FK would fight that. The consequence is that the API must do
the checking itself, and until 2026-08-24 it did not: `POST /api/tasks` accepted
any string and wrote it straight to the column, including a user id from another
workspace.

`canAssignTo` in `lib/tasks.ts` now gates both create and reassign against the
same hierarchy leads and pipelines already use. `GET /api/tasks/assignees`
returns only the people a caller may legally pick, so the picker and the guard
cannot drift apart. Assigning a single contact (`PATCH /api/leads/[id]` with
`ownerId`) goes through the same check.
