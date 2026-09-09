# security.md — Auth, Secrets, Encryption, Compliance

**Last updated:** 2026-07-03
**Status:** draft

> No secrets in source, logs, or client code. Least privilege everywhere. Consent and
> opt-out are non-negotiable.

---

## Authentication

**User login (our app).** Auth0 / Clerk — gives user management, MFA, sessions out of
the box. Sessions via HTTPS-only cookies or JWTs. All endpoints behind auth checks.

**Per-service auth (outbound).**
- **Gmail/Google:** OAuth2 with refresh tokens (rotate regularly); or SMTP with app
  passwords. Request minimal scopes.
- **LinkedIn:** OAuth2; store per-user tokens; note scope restrictions
  ([channels.md](channels.md)).
- **Twilio/WhatsApp:** use scoped **API keys** (not the master account key); store
  encrypted.
- Prefer **short-lived tokens**; limit each token's scope to what its service needs.

## Access control (RBAC)
- Roles, as actually implemented on `Member.role` (see `lib/tenant.ts`):
  `owner`, `admin`, `group_leader` (shown as **Manager**), `member` (**Team member**).
  There is no `viewer`.
- Two orthogonal axes: **role** gates what you can configure (`requireRole`),
  **department** gates what data you can see (`isDepartmentScoped`,
  `requireDepartmentAccess`). A member with no department sees nothing
  department-scoped — fail closed, not fail open.
- Creating or deleting a mailbox, and creating or editing a campaign, require
  `owner`/`admin`. Reading stays open to members, who need it to work.
- Enforce on every API route; there are no server actions in this codebase, so
  `requireOrg` in the route handler is the single write-side chokepoint.

## Secrets management (OWASP-aligned)
- Store all credentials in **env vars / a vault** — never in the repo.
- **Least privilege:** not every service gets every key.
- **Automated rotation**; log access to secret operations.
- Centralize + audit — scattered secrets in code/config are the top leak source.
- `.env.example` documents required keys with placeholder values only.

## Data protection
- **Encrypt PII at rest** (emails/phones — encrypted DB columns or app-level).
- **TLS/HTTPS** for all traffic.
- **Never** put PII or API keys in logs or client-side bundles.
- Encrypted, regular database backups.

## Web app hardening
- CSRF protection; framework auto-escaping to prevent XSS; sanitize all inputs.
- Enforce CORS on APIs.
- Rate-limit our own inbound endpoints (protect against abuse and slow third parties).

## Monitoring & alerting
- Structured audit log of every outreach action (sent / delivered / clicked / bounced).
- Alerts on: bounce/spam spikes, unusual send rates, server errors, secret-access
  anomalies. Auto-pause campaigns on threshold breach (see [rate-limits.md](rate-limits.md)).

## Compliance (GDPR & channel consent)
- **Consent** before contacting (explicit opt-in required for WhatsApp).
- **Unsubscribe** in every email; global suppression list honored across channels.
- **Right to deletion** — provide a path to delete a person's data.
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

Not encrypted, on purpose: `Lead.email` (it is unique-constrained and searched,
and a blind index there would touch the identity graph, CSV import and reply
matching) and `Account.password` (already a one-way scrypt hash from
better-auth — encrypting it would be strictly worse).

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
cannot drift apart.
