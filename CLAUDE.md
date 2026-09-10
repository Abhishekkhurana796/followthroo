# CLAUDE.md — LeadsKonnect (Multi-Channel Outreach Platform)

> Master context file. Claude Code reads this every session. If it conflicts with
> what you see in code, trust the code and update this file.

**Last updated:** 2026-09-02
**Status:** draft

---

## What we are building

An AI-powered **multi-channel outreach platform**. Think of it as conducting a
multi-instrument symphony — each channel (Email, LinkedIn, WhatsApp, social comments)
plays its own part, yet must sync perfectly. The system automates personalized
outreach across channels, tracks every lead and interaction in a CRM, respects every
platform's rate limits, and is driven by a Claude agent that orchestrates the
sequence. A premium Next.js UI sits on top.

## Tech stack (assumed by all docs)

| Layer | Choice |
|---|---|
| App framework | **Next.js (App Router)** — full-stack; API routes + server actions |
| Language | **TypeScript** everywhere |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite` / Next integration) |
| Animation | Standard **`requestAnimationFrame`** (60fps carousel) + **motion / Framer Motion** (scroll reveals) |
| Icons | **Lucide React** |
| Email | **Nodemailer** / Gmail API (OAuth2, DKIM/SPF); optional SendGrid/Mailgun for volume |
| WhatsApp | **Twilio** Programmable Messaging (or Meta Business API) |
| LinkedIn | Official REST API where possible; else Puppeteer/Playwright browser automation (careful) |
| Data | **PostgreSQL** (or HubSpot CRM via API) |
| Jobs/queues | **BullMQ** (throttling, scheduling, retries) |
| Auth | **better-auth** (email/password + Google) with its organization plugin; per-service OAuth2 server-to-server |
| Deploy | Vercel (Fluid Compute; Node 24 LTS) |

## Repo conventions

- `app/` — Next.js routes (UI + API). `app/api/<channel>/…` for channel endpoints.
- `lib/channels/{email,linkedin,whatsapp,social}/` — per-channel logic.
- `lib/crm/`, `lib/templates/`, `lib/agent/`, `lib/ratelimit/` — cross-cutting modules.
- `components/` — UI. The four supplied assets live under `components/marketing/`.
- Secrets only via env / vault — **never** in source. See `docs/security.md`.

## Hard rules (guardrails — do not violate)

- **Rate limits are law.** Gmail ≤500/day free · ≤2,000/day paid Workspace;
  LinkedIn ~20 invites/day (ramp slowly); WhatsApp 250 unique/24h (tiers up after
  verification). Full table: `docs/rate-limits.md`.
- **Throttle + humanize** all automation: queue everything, add random jitter
  (30–90s between actions), warm up new accounts. Never burst.
- **No secrets in source, logs, or client code.** Least-privilege tokens, rotation,
  vault. See `docs/security.md`.
- **Platform secrets live in env; tenant credentials live in the database only as
  ciphertext.** A customer connecting their own mailbox, WhatsApp number or SMS
  provider means their credential has to be stored — so it goes through the
  Prisma extension in `lib/db-encryption.ts` (AES-256-GCM, key in
  `ENCRYPTION_KEYS`, outside the database). Never add a credential column without
  adding it to `ENCRYPTED_COLUMNS`, and never filter on one — encrypted columns
  cannot appear in a `where`; use a blind index (`lib/crypto.ts`).
- **A SendingAccount row must never reach a browser.** It carries `pass`,
  `refreshToken` and `dkimPrivateKey`. Use `SEND_ACCOUNT_SELECT` /
  `CAMPAIGN_INCLUDE` from `lib/queries.ts`; a bare
  `include: { sendingAccount: true }` is a credential leak.
- **Respect consent & opt-out.** Maintain a suppression list; honor unsubscribe and
  GDPR deletion. WhatsApp requires opt-in + approved templates.
- **Design system is binding.** Follow `design_constraints.md` — especially the
  white-on-`#FF0000` contrast rule (fails AA for body text).
- **The sidebar is not an index of the codebase.** New surfaces go *inside* an
  existing screen — a tab, a dialog, a sub-nav row, a panel on the lead record —
  unless they serve one of the five questions in `docs/information-architecture.md`.
  The rail went from 18 rows to 11 for a reason; don't grow it back.
  **Superseded 2026-09-08: LinkedIn no longer has its own row — it lives under
  Channels.** It had one from 2026-09-03, because it was first built inside the
  Add Lead dialog, correctly per this rule, and failed the only test that
  matters: the person who commissioned it could not find it. A destination with
  a URL beat a good argument about nav hygiene.
  `/dashboard/channels` keeps that win — it is still a destination with a URL,
  one click from the rail — while fixing what the row could not: Email lived in
  Settings, LinkedIn on the rail, WhatsApp and SMS behind Settings → Business
  channels. Four things of one kind in three places, and no screen answering
  "what can I actually send through today?". The hub links out to where each is
  really configured; nothing moved and nothing is duplicated.
  The original justification was "35 distinct jobs", and that turned into a
  catalogue of 32 read-only cards — 19 of them greyed-out roadmap — under a
  heading claiming 35. A roadmap is not product surface; it is back in
  `docs/phantombuster.md`. The row now earns its place on one job: **getting
  people out of LinkedIn and into the CRM**, plus the health of the connection
  that makes that possible.
  **No paste-a-link importer (removed 2026-09-10, the client's call).** People
  come in by being ticked on LinkedIn with the extension's in-page bar, or by CSV
  with a `linkedin url` column. The LinkedIn screen shows what those imports
  produced and the connection's health. Do not put a URL field back — on that
  screen or in Add Lead.
  **Outreach is not there.** Sending a connection request or a message is a step
  in a campaign, beside Email and WhatsApp, because a channel is a property of a
  step and not a place you visit. If you are about to add a "send" affordance to
  the LinkedIn screen, add it to the campaign builder instead.
- **LinkedIn invitations are sent by the desktop app, not the extension.**
  Decided 2026-09-07. LinkedIn's API cannot send an invitation or a DM to a
  non-connection — `w_member_social` only posts to your own feed — so it takes a
  real browser with a real session. `desktop/` is an Electron app that drives
  Chrome with Playwright on the customer's own machine and IP; the server side is
  unchanged (same `extToken`, same `/api/linkedin/queue`, same `claimActions`).
  The Chrome extension still does **sourcing** and no longer claims invite
  actions at all. That is not a preference: `claimActions` marks a row
  `in_progress` with a read then a write, so two clients on one queue can each
  hold the same action and each send it, and an invitation cannot be recalled.
  **One claimer, always.** If you add a third client, it takes the queue from the
  desktop app — it does not poll alongside it.
  The DOM logic lives once, in `desktop/page-actions.js`, shared by the app and
  both verification scripts. Do not copy it; a selector fix has to land in the
  code that ships.
  **An explicit invite never becomes a message.** "Already connected" and "I
  could not find the Connect button" look identical on the page, so messaging on
  the absence of a button meant every selector miss DM'd somebody a
  connection-request note. Falling back to a message requires positive evidence
  of a connection (1st-degree badge, or "Remove Connection"), and only for
  `type: "auto"`. No evidence means `failed`, which is what stops a run after
  three and surfaces a LinkedIn markup change.
  **The desktop app embeds the hosted web app in a `WebContentsView` with no
  preload.** The panel's preload can start browser automation; giving remote
  content that reach is the one genuinely dangerous mistake available in
  `desktop/main.js`.
- **The user never needs to understand the integration.** A lead is a lead whether it
  came from IndiaMART, Meta Ads or a CSV; the source is metadata, never a destination.
- **Never take payment for a domain.** The reseller storefront charges the customer and
  credits us the margin — a checkout in the app would bill them twice. See
  `docs/domains-and-mailboxes.md` before touching anything in `lib/domains/`.
- **The agent layer runs through OpenRouter**, via its Anthropic-compatible
  endpoint, so one SDK and one wire format serve every model. The model is
  `OPENROUTER_MODEL` (provider-prefixed ids, e.g. `minimax/minimax-m2`,
  `anthropic/claude-...`) and failover is `OPENROUTER_FALLBACK_MODELS` — not a
  second provider integration. `ANTHROPIC_API_KEY` still works as a direct
  alternative when no OpenRouter key is set.
  This replaces the previous "use the latest Claude model" rule. The agent leans
  hard on tool calling — `send_message`, `draft_message`, `move_stage`,
  `update_lead_fields` — so a model with weaker tool adherence shows up as wrong
  actions on real leads, not merely worse prose. Test a model change on
  **Test emails** (`/dashboard/agent`, one lead per run) before trusting it.

## Documentation index (the map)

| Doc | What's in it |
|---|---|
| [design_constraints.md](design_constraints.md) | Design system: fonts, colors, WCAG, motion, layout |
| [README.md](README.md) | Human overview + getting started |
| [ROADMAP.md](ROADMAP.md) | Phased build plan + status |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design & data flow |
| [docs/information-architecture.md](docs/information-architecture.md) | Product IA, navigation, and the core screens |
| [docs/channels.md](docs/channels.md) | Per-channel features + official limits |
| [docs/linkedin-sourcing-ux.md](docs/linkedin-sourcing-ux.md) | How LinkedIn sourcing is presented: why the URL is the input and there is no scraper picker |
| [desktop/README.md](desktop/README.md) | The Windows app that sends LinkedIn invitations: why it is not a server, what stops a run, how to build and sign it |
| [docs/phantombuster.md](docs/phantombuster.md) | The 35 PhantomBuster LinkedIn automations: inputs, outputs and limits, as the reference spec for our own scrapers |
| [docs/rate-limits.md](docs/rate-limits.md) | Consolidated quotas + throttling strategy |
| [docs/pricing.md](docs/pricing.md) | Recurring costs (infra + AI/comms COGS) + pricing tier margin analysis |
| [docs/security.md](docs/security.md) | OAuth2, secrets, encryption, RBAC, GDPR |
| [docs/domains-and-mailboxes.md](docs/domains-and-mailboxes.md) | Sending domains via the reseller storefront, DNS verification, mailbox connect |
| [docs/crm-data-model.md](docs/crm-data-model.md) | Lead schema, logs, CSV import/export |
| [docs/templates-and-variables.md](docs/templates-and-variables.md) | Template engine, variables, sequencing |
| [docs/ai-agent.md](docs/ai-agent.md) | Claude agent: tools, prompt, safety |
| [docs/ui-components.md](docs/ui-components.md) | The four supplied frontend assets |

## How to keep this file (and the docs) updated

1. Every doc carries `Last updated:` and `Status: (draft | stable | needs-review)`.
2. **This doc index is the single map** — when you add a doc, link it here.
3. **After any build phase, update the matching doc in the same change.** Code and
   docs move together; a PR that changes channel logic must touch `docs/channels.md`.
4. When a guardrail number changes (a platform raises a limit), update
   `docs/rate-limits.md` first, then the guardrail bullets above.
