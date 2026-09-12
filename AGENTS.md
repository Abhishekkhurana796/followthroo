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

## Where things stand (2026-09-13, end of this session)

On `feat/multitenant-crm-analytics`, merged into `main` as work lands (this repo
deploys `main` straight to production on Vercel). All four phases of the
2026-09-12 plan (`~/.claude/plans/this-is-a-copy-luminous-dove.md` on the
machine that ran this session — the decisions in it are settled, not to be
re-litigated) are now built: **P1 billing, P2 enrichment, P3 Posts**. A full
handoff for a fresh session (Codex or otherwise) was written at the end of
this session — ask the user for it, or check this conversation's final
message, for the complete picture: what's shipped, what's verified vs. not,
and the prioritized list of what's left. `docs/pricing.md`, `docs/enrichment.md`
and `docs/posts.md` are the three living docs for those phases respectively.

**P2 (enrichment), done:** schema, the claim/charge/merge engine
(`lib/linkedin/enrich.ts`), a campaign `enrich` node, desktop DOM code, web UI,
21/21 verify checks. **Not verified against a live LinkedIn account** — the
Contact-info overlay selectors are a best guess from documented markup.
Desktop app version is **not bumped or released** for this.

**P3 (Posts + Autopilot), done:** schema (`Post`, `Autopilot`, `AutopilotRun`,
`ProductInterest`), `lib/posts/{models,research,write,schedule}.ts`,
`lib/linkedin/post.ts` image upload, the `post-publish` queue job +
`/api/cron/posts-sweep`, a "Posts" row under Automate, and a full UI (home,
editor, autopilot setup). 9/9 verify checks — but that script deliberately
never calls OpenRouter or LinkedIn's Images API; see `docs/posts.md`'s "What's
unverified" for exactly what a first real run needs to confirm.

Every doc lives under `docs/` and is indexed in CLAUDE.md's "Documentation
index" table — check there before assuming a topic is undocumented.
