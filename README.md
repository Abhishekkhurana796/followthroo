# Followthroo

An AI-powered multi-channel outreach platform that automates personalized campaigns
across **Email, LinkedIn, WhatsApp, and social comments**, backed by a CRM, a template
engine, a rate-limiting/safety layer, and a Claude agent that orchestrates the whole
sequence — fronted by a premium Next.js UI.

**Last updated:** 2026-09-09
**Status:** foundation built — most channels wired, need credentials to go live

---

## Why

Personalized outreach gets replies; generic blasts get ignored — and get accounts
banned. Followthroo scales personalization while respecting every channel's hard
limits, so it can run at volume *without* tripping spam detection or platform throttles.

## Tech stack

Next.js (App Router, full-stack) · TypeScript · Tailwind CSS v4 · motion/Framer Motion ·
Nodemailer (+DKIM) · Twilio (WhatsApp) · PostgreSQL + Prisma · Redis + BullMQ ·
`@anthropic-ai/sdk` pointed at **OpenRouter** · Electron + Playwright (the LinkedIn
desktop app) · Vercel.

## Run it locally

**Prerequisites:** Node 20+ (Node 24 LTS recommended) and npm. Postgres + Redis are
optional to *boot* the app, but required for anything that touches the CRM or queue.

```bash
# 1. install dependencies
npm install

# 2. create your env file, then edit it (see the table below / SETUP.md)
cp .env.example .env.local

# 3. (optional but recommended) spin up Postgres + Redis locally with Docker
docker run -d --name lk-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=leadskonnect -p 5432:5432 postgres:16
docker run -d --name lk-redis -p 6379:6379 redis:7
# then in .env.local:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/leadskonnect
#   REDIS_URL=redis://localhost:6379

# 4. generate the Prisma client + create the tables
npm run db:generate
npm run db:push

# 5. start the app  →  http://localhost:3000
npm run dev

# 6. (separate terminal) start the send worker for queued/sequenced campaigns
npm run worker
```

### Verify it's up

```bash
curl http://localhost:3000/api/status        # shows which integrations are configured
```

Open the pages:

- `/` — landing (3D card carousel, red manifesto hero, branding section)
- `/dashboard` — command center
- any unknown path — the NEXOVA 404

### The app boots without any credentials

Every integration degrades gracefully: if a channel's env vars are missing, it reports
`"not configured"` instead of crashing. Fill in only the channels you want live. If you
skip Postgres/Redis, the UI still runs — only the CRM/queue API routes return `503`.

## Environment variables (short list)

| Var | Needed for |
|---|---|
| `DATABASE_URL` | CRM, campaigns, agent (Postgres) |
| `REDIS_URL` | queue + shared rate limits (falls back to in-memory without it) |
| `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` | Email sending |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM` | WhatsApp |
| `LINKEDIN_ACCESS_TOKEN` or `LINKEDIN_LI_AT` | LinkedIn sign-in and posting **only** — not invitations (see below) |
| `OPENROUTER_API_KEY` | AI agent and the LinkedIn pilot; `ANTHROPIC_API_KEY` works as a direct alternative |
| `OPENROUTER_MODEL` · `OPENROUTER_PILOT_MODEL` | agent model · the model that drives the browser |
| `ENCRYPTION_KEYS` | at-rest encryption for tenant credentials (never in the database) |
| `APP_SECRET` | sessions/tokens |

Full list + manual steps (fonts, DKIM DNS, Twilio templates, LinkedIn driver, webhook
signatures) are in **`SETUP.md`**.

## npm scripts

| Script | Does |
|---|---|
| `npm run dev` | start Next.js dev server |
| `npm run build` / `npm start` | production build / serve |
| `npm run worker` | BullMQ send worker (throttled, humanized sends) |
| `npm run db:push` / `db:generate` / `db:studio` | Prisma schema push / client / GUI |
| `npm run typecheck` / `lint` | TS + lint checks |
| `npm run verify:linkedin` | the LinkedIn safety suites — run these before shipping anything in `desktop/` |
| `npm run desktop` / `desktop:dist` | run / build the Windows invitation app |

## Key API routes

| Route | Purpose |
|---|---|
| `GET/POST /api/leads` | list / upsert leads |
| `GET/PATCH/DELETE /api/leads/:id` | read / update / GDPR-delete |
| `POST /api/leads/import` | CSV import (maps columns → variables, dedupes) |
| `GET/POST/PUT /api/campaigns` | list / create / launch a sequence |
| `POST /api/agent` | run the orchestration agent |
| `GET/POST /api/linkedin/queue` | the desktop app claims invitations here and reports outcomes |
| `POST /api/linkedin/assist` | one decision: what should the desktop app click next |
| `POST /api/webhooks/email` · `/whatsapp` | bounce / reply / opt-out handling |
| `GET /api/status` | health + integration map |

## LinkedIn invitations come from a desktop app

LinkedIn's API cannot send a connection request or a message to somebody you are
not connected to — `w_member_social` only posts to your own feed — so invitations
are sent by a real browser, on the customer's own machine and IP. `desktop/` is an
Electron app that drives Chrome with Playwright; the server's job is the queue and
the CRM, and it is unchanged from the extension era: same pairing token, same
`/api/linkedin/queue`, same `claimActions`.

Two things are worth knowing before touching it:

- **One claimer, always.** `claimActions` marks a row `in_progress` with a read
  then a write, so two clients polling one queue can each hold the same action and
  each send it — and an invitation cannot be recalled. The Chrome extension still
  does sourcing and no longer claims invite actions at all.
- **A model decides what to click; the client decides what is allowed.** The page
  is described to a model, which answers with one element; `desktop/pilot-page.js`
  then refuses anything in the sidebar, anything destructive, anything naming
  somebody else, and anything it cannot attribute to the profile being visited.

`desktop/README.md` has the rest: what stops a run, how attribution works, and how
to build and sign the installer.

## Project docs (kept local, not in this repo)

Architecture, design system, per-channel rules, rate limits, security, and the data
model live in `CLAUDE.md`, `design_constraints.md`, `ROADMAP.md`, and `docs/`. They are
intentionally gitignored. See the "keep updating" protocol in `CLAUDE.md` — code and
docs move together.

## Channel limits at a glance

| Channel | Starting limit |
|---|---|
| Email (Gmail) | 500/day free · 2,000/day paid Workspace |
| LinkedIn | ~20 invites/day (ramp slowly) |
| WhatsApp | 250 unique contacts / 24h (tiers up after verification) |

Enforced centrally in `lib/channels/safeSend` (suppression + rate limit before every send).
