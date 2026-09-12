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

## Where things stand (2026-09-13, updated mid-session)

On `feat/multitenant-crm-analytics`, merged into `main` as work lands (this repo
deploys `main` straight to production on Vercel). P1 (billing/credits/Razorpay)
shipped — see `docs/pricing.md`. **P2 (enrichment) is built and pushed**; **P3
(Posts + Autopilot) is next, in progress as this file is being updated** — see
`docs/enrichment.md` and (once written) `docs/posts.md` for the details, and the
full handoff written for Codex (ask the user for it, or check this session's
final message) for exactly what's done vs. still open across both.

**P2, done:** schema (`LinkedInEnrichment`, `LinkedInAccount.dailyEnrichCap` /
`autoEnrichOnAccept`), the claim/charge/merge engine (`lib/linkedin/enrich.ts`),
three routes, a campaign `enrich` node + `has_email`/`has_phone` condition
(`lib/campaign-engine.ts`), auto-enrich on accept, web UI (Leads bulk action,
lead record button, campaign step, LinkedIn settings), desktop DOM code
(`desktop/page-actions.js`'s `readContactInfo`, `desktop/enrich-flow.js`,
wired into `runner.js` after the invite lane), docs, changelog, and
`scripts/verify-linkedin-enrichment.ts`. **Not verified against a live LinkedIn
account** — the Contact-info overlay selectors are a best guess from documented
markup, same as every selector in `page-actions.js` started life. Desktop app
version has **not** been bumped or released for this — the code is merged but
sitting unbuilt until someone runs it against a real profile first.

Every doc lives under `docs/` and is indexed in CLAUDE.md's "Documentation
index" table — check there before assuming a topic is undocumented.
