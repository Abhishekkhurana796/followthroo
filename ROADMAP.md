# ROADMAP.md — Phased Build Plan

> Build order and status. Update the status column as phases complete. Each phase
> ships with its matching doc updated in the same change.

**Last updated:** 2026-08-19
**Status:** foundation built; V3 product surface underway

---

## Legend
`☐ not started` · `◐ in progress` · `☑ done`

## Phases

| # | Phase | Scope | Status | Primary doc |
|---|---|---|---|---|
| 0 | **Documentation** | This doc set: CLAUDE.md, design system, channel/limit/security/data/template/agent/UI docs | ☑ | all |
| 1 | **Scaffold + CRM/DB** | Next.js App Router app, Tailwind v4, Postgres schema, lead CRUD, CSV import | ☑ | [docs/crm-data-model.md](docs/crm-data-model.md) |
| 2 | **Email channel** | Nodemailer + DKIM, queue + throttle, bounce webhook | ◐ needs SMTP creds | [docs/channels.md](docs/channels.md) |
| 3 | **Templates + sequencing** | Handlebars engine + `{{x\|fallback}}`, spam check, sequences via BullMQ | ☑ | [docs/templates-and-variables.md](docs/templates-and-variables.md) |
| 4 | **LinkedIn channel** | Queue + caps server-side; sourcing via Chrome extension; invitations sent by the `desktop/` Windows app (Electron + Playwright) | ☑ driver shipped 2026-09-07 | [docs/channels.md](docs/channels.md), [desktop/README.md](desktop/README.md) |
| 5 | **WhatsApp channel** | Twilio send + status webhook + opt-out | ◐ needs Twilio creds | [docs/channels.md](docs/channels.md) |
| 6 | **Social comments** | Interface stub only | ☐ | [docs/channels.md](docs/channels.md) |
| 7 | **AI agent** | Claude (`claude-opus-4-8`) tool-loop over safe send path | ◐ needs API key | [docs/ai-agent.md](docs/ai-agent.md) |
| 8 | **Premium UI** | 4 supplied assets built (carousel, red hero, branding section, NEXOVA 404) + dashboard shell | ◐ polish | [docs/ui-components.md](docs/ui-components.md) |

## V3 — one-stop CRM

Turning a strong outreach engine into a CRM a salesperson can use without being
taught. The backend spine (identity graph, unified conversation, pipeline engine,
lead sources) was already built; V3 is mostly product surface.

| # | Phase | Scope | Status | Primary doc |
|---|---|---|---|---|
| V3.1 | **The spine** | `Task`/`Note` + next-action engine, the lead detail page, Tasks screen, action-first Home, 18→11 nav, Contacts→Leads | ☑ | [docs/information-architecture.md](docs/information-architecture.md) |
| V3.2 | **Conversation** | Inbox CRM right-rail + channel filter/switch + AI reply suggestion; first-class `Company` model with backfill; deal detail | ☐ | [docs/information-architecture.md](docs/information-architecture.md) |
| V3.3 | **AI as the interface** | "What do you want to get done?" over the existing tool loop, with read / write / external confirmation tiers; Calendar + Meetings; adapter `health()`; Campaigns→Sequences | ☐ | [docs/ai-agent.md](docs/ai-agent.md) |

> Build notes: full env-var list + manual steps in `SETUP.md`. Every integration
> degrades gracefully when its creds are absent (`GET /api/status` shows the map).
> Rate limits + suppression are enforced centrally in `lib/channels/safeSend`.

## Reliability fixes
- **Sequence follow-ups could stall silently** (fixed 2026-08-19). A campaign advanced
  via a single in-flight queue message per lead, so one dropped/rejected QStash publish
  ended that lead's sequence with nothing surfaced. Added `maxDuration` to
  `/api/qstash/process`, an enrollment recovery sweep on `nextRunAt`
  (`/api/cron/enrollment-sweep`, every 10 min), an atomic per-enrollment claim, a
  campaign-status guard so paused/done campaigns are never resumed, and
  `scripts/verify-sequence.ts` to inspect where enrollments are parked.
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Sending domains (shipped 2026-08-23)
- **Buy a sending domain without leaving the product.** Cold outreach on a company's
  primary domain eventually gets that domain filtered, and the manual fix — register a
  lookalike, configure MX/SPF/DKIM/DMARC, provision a mailbox, come back and connect it —
  is where people give up. Three steps now: pick a name, buy it in the reseller
  storefront, connect the mailbox. DNS is verified against public resolvers on a backoff
  with a 5-minute recovery sweep, and the mailbox lands as an ordinary `SendingAccount`
  so warm-up, the reply poller and `safeSend` need no changes.
  The storefront takes the payment and credits the margin, so there is deliberately no
  checkout, no order table and no registrar API in the app.
  [docs/domains-and-mailboxes.md](docs/domains-and-mailboxes.md)

## Tasks that actually chase you (shipped 2026-08-24)
- **A due date that does something.** Creating a task offered one text field: no
  assignee, no date picker, and a hardcoded due-now, so every task was a follow-up
  owned by whoever clicked and already overdue. Worse, nothing ever fired — "overdue"
  was a query scope, so a task went red on a screen nobody had open, and the
  Notifications settings wrote to localStorage and admitted it in its own footer.
  Now: a real form (assignee, due presets defaulting to tomorrow 9am, type, priority,
  instruction, contact), role-scoped assignment enforced server-side, an owner nudge
  when a task comes due, escalation to the manager a day later recorded on the existing
  Escalations screen, and a morning digest at local 8am. Preferences persist per user.
  [docs/crm-data-model.md](docs/crm-data-model.md)

## Cross-cutting (land alongside relevant phases)
- **Rate limiting** (token buckets, jitter, warm-up) — begins in Phase 2, reused everywhere. [docs/rate-limits.md](docs/rate-limits.md)
- **Security** (OAuth2, secrets vault, RBAC, encryption, GDPR) — begins in Phase 1, hardened each phase. [docs/security.md](docs/security.md)
- **Observability** (audit logs, bounce/spam monitoring, alerts) — begins in Phase 2.

## Definition of done (per phase)
1. Feature works end-to-end against a real/sandbox account.
2. Rate limits + safety stops enforced in code (not just documented).
3. Matching doc updated; CLAUDE.md guardrails still accurate.
4. Secrets in vault/env; nothing sensitive in source or logs.
