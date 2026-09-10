# SETUP.md — LeadsKonnect: env vars + manual steps

**Last updated:** 2026-07-03
**Status:** draft (local only — gitignored, not pushed)

The app boots even with a partial `.env.local`; any unconfigured integration simply
reports itself as "not configured" (`GET /api/status` shows the map). Fill in only the
channels you want live.

---

## 1. Install + run

```bash
npm install
cp .env.example .env.local     # then fill in values below
npm run db:generate            # prisma client
npm run db:push                # create tables (needs DATABASE_URL)
npm run dev                    # http://localhost:3000
# in a second terminal, for queued/sequenced sends:
npm run worker                 # needs REDIS_URL + DATABASE_URL
```

## 2. Environment variables

| Var | Needed for | Notes |
|---|---|---|
| `APP_SECRET` | sessions/tokens | 32+ random chars |
| `DATABASE_URL` | everything CRM | PostgreSQL connection string |
| `REDIS_URL` | queue + shared rate limits | also holds the API and sign-in rate limits; without it they are per-instance (dev only) and sequencing is disabled |
| `SMTP_HOST/PORT/SECURE/USER/PASS` | Internal mail, sign-up confirmation | notifications and email-confirmation links to your own users only — outreach uses each workspace's connected Sending account. **Required in production:** without it, password sign-ups are not email-verified (see docs/security.md) |
| `MAIL_FROM` | Internal mail | From header on those notifications |
| `DKIM_DOMAIN/KEY_SELECTOR/PRIVATE_KEY` | Email deliverability | recommended |
| `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/SENDER` | Email via Gmail API | alternative to SMTP |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM` | WhatsApp | `whatsapp:+1...` sender |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn (official API, org pages) | partner-gated |
| `LINKEDIN_LI_AT` | LinkedIn (browser automation) | gray area; you implement the driver |
| `ANTHROPIC_API_KEY` | AI agent | model defaults to `claude-opus-4-8` |
| `RL_EMAIL_PER_HOUR` / `RL_LINKEDIN_PER_DAY` / `RL_WHATSAPP_PER_DAY` | rate limits | safe defaults 40 / 20 / 250 |

## 3. Manual steps (things I can't do for you)

1. **Provision Postgres + Redis.** Local (Docker) or hosted (Vercel Marketplace:
   Neon/Supabase for PG, Upstash for Redis). Put the URLs in `.env.local`.
2. **Fonts.** Drop `ApocRevelations-Italic.woff2` into `public/fonts/` (licensed face —
   I can't ship it). DM Sans / Italiana / Manrope / Marck Script / JetBrains Mono load
   from Google Fonts automatically; Helvetica Now Var loads from onlinewebfonts.
3. **Email.** Create an SMTP app password (or Gmail OAuth2 refresh token). Add SPF +
   DKIM DNS records on your sending domain (see `docs/security.md`).
4. **WhatsApp.** Set up Twilio WhatsApp sender (sandbox to start), get numbers opted in,
   and register message templates in Meta for sends outside the 24h window.
5. **LinkedIn.** Decide: official API (apply for partner access) **or** implement the
   browser driver in `lib/channels/linkedin.ts`. Nothing sends until one is wired.
6. **Anthropic.** Add `ANTHROPIC_API_KEY` to enable `POST /api/agent`.
7. **Webhook verification.** Add signature checks in `app/api/webhooks/*` before prod
   (Twilio `X-Twilio-Signature`, your email provider's signature).
8. **Auth.** Wire Auth0/Clerk for real user login before exposing the dashboard.

## 4. Try it (once DB is up)

```bash
# health / integration map
curl localhost:3000/api/status

# create a lead
curl -X POST localhost:3000/api/leads -H 'content-type: application/json' \
  -d '{"email":"jane@acme.com","firstName":"Jane","company":"Acme"}'

# import a CSV (unknown columns become template variables)
curl -X POST localhost:3000/api/leads/import -H 'content-type: text/csv' \
  --data-binary $'email,firstName,company,painPoint\njane@acme.com,Jane,Acme,slow onboarding'

# run the agent over leads
curl -X POST localhost:3000/api/agent -H 'content-type: application/json' \
  -d '{"leadIds":["<id>"],"brief":"Intro our onboarding automation, warm and short."}'
```

## 5. Key API routes

| Route | Purpose |
|---|---|
| `GET/POST /api/leads` | list / upsert leads |
| `GET/PATCH/DELETE /api/leads/:id` | read / update / GDPR-delete |
| `POST /api/leads/import` | CSV import (maps + dedupes) |
| `GET/POST/PUT /api/campaigns` | list / create / launch (enqueues sequence) |
| `POST /api/agent` | run the Claude orchestration agent |
| `POST /api/webhooks/email` · `/whatsapp` | bounce/reply/opt-out handling |
| `GET /api/status` | health + which integrations are configured |
