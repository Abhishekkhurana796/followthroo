# AGENTS.md — LeadsKonnect / Followthroo

This repo's real context file is **[CLAUDE.md](CLAUDE.md)** — read it before touching
anything. It carries the stack, repo conventions, the documentation index, and every
hard guardrail (rate limits, encryption, LinkedIn sending, credits). This file exists
because some agents (Codex CLI among them) look for `AGENTS.md` specifically and
won't otherwise find that pointer. Nothing here should drift from CLAUDE.md — if the
two disagree, CLAUDE.md is right; fix this file to match rather than the other way
round.

## The guardrails that matter most

- **No secrets in source, logs, or client code.** Platform secrets live in env;
  tenant credentials (a customer's mailbox, WhatsApp number, LinkedIn OAuth token,
  Razorpay auto-recharge token) are stored only as ciphertext through the Prisma
  extension in `lib/db-encryption.ts`. Adding a credential column means adding it to
  `ENCRYPTED_COLUMNS` in that file — never add one without the other.
- **A `SendingAccount` row must never reach a browser.** It carries `pass`,
  `refreshToken`, `dkimPrivateKey`. Use `SEND_ACCOUNT_SELECT` / `CAMPAIGN_INCLUDE`
  from `lib/queries.ts`.
- **LinkedIn invitations are sent by the desktop app (`desktop/`), never the
  extension.** The extension only sources. `claimActions` in `lib/linkedin/queue.ts`
  has exactly one claimer, always — a second client claiming from the same queue
  double-sends, and an invitation cannot be recalled.
- **Credits go through `lib/billing/meter.ts`, never by hand.** `charge()` before a
  thing happens, `keepCredits`/`returnCredits` after. Prices and limits live once in
  `lib/billing/plans.ts`. Nothing is charged until `BILLING_ENFORCED=1`.
- **Never take payment for a domain** (see `docs/domains-and-mailboxes.md`), and
  never bill through anything but `lib/billing/razorpay.ts` (test keys only —
  `RAZORPAY_API_KEY` / `RAZORPAY_SECRET` are Razorpay **test-mode** credentials).
- **The database is prod-only Supabase Postgres.** There is no staging DB. Preview
  any schema change, push columns before the code that reads them, and get
  confirmation before a push or before running a backfill script against it.

## Commands

```bash
npm run typecheck              # tsc --noEmit — run before every commit
npm run build                  # prisma generate && next build
npx tsx --env-file=.env scripts/verify-credits.ts        # billing engine, ~60 assertions
npx tsx --env-file=.env scripts/verify-linkedin-notes.ts  # note-allowance queue logic
npx tsx --env-file=.env scripts/verify-linkedin-campaign-steps.ts
```

Desktop app (`desktop/`): unset `ELECTRON_RUN_AS_NODE` before `npm start` or
`npm run dist` — this shell exports it, and Electron blames your code for a crash
that's actually that env var.

## Where things stand (2026-09-13)

On `feat/multitenant-crm-analytics`, merged into `main` as work lands (this repo
deploys `main` straight to production on Vercel). Just shipped: the $2 Test
Drive / $10 / $20 / $50 credit-metered pricing, the credit ledger and
`lib/billing/`, Razorpay Checkout for the Test Drive and top-up packs (test
keys only — Subscriptions isn't enabled on the Razorpay account yet, so
monthly plans are still set up by hand), plan feature gates (`PlanUpsell`,
`upgradeFor`), seat/role limits via better-auth's `organizationHooks`, and
"Choose what stays active" for a workspace running over its plan. See
`docs/pricing.md` for the full state and what's still open.

Every doc lives under `docs/` and is indexed in CLAUDE.md's "Documentation
index" table — check there before assuming a topic is undocumented.
