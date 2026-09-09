# ARCHITECTURE.md — System Design

**Last updated:** 2026-08-19
**Status:** draft

---

## Shape

A single **Next.js (App Router) full-stack** application on Vercel (Fluid Compute,
Node 24 LTS). One codebase, not microservices — channel work is isolated by module,
and long-running / rate-limited work is pushed to a **job queue** rather than separate
services.

```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js App (Vercel)                      │
│                                                               │
│  app/ (UI)            app/api/ (endpoints + webhooks)         │
│   ├─ dashboard         ├─ /api/leads      (CRM CRUD, CSV)     │
│   ├─ campaigns         ├─ /api/campaigns  (sequences)         │
│   ├─ templates         ├─ /api/webhooks/* (bounces, WA status)│
│   └─ settings          └─ /api/agent      (Claude run)        │
│                                                               │
│  lib/  channels/{email,linkedin,whatsapp,social}             │
│        crm/  templates/  ratelimit/  agent/                  │
└───────────────┬───────────────────────────┬─────────────────┘
                │                             │
        ┌───────▼────────┐            ┌───────▼────────┐
        │  PostgreSQL    │            │  BullMQ queue  │
        │ leads, msgs,   │            │ (Redis)        │
        │ campaigns,logs │            │ throttled jobs │
        └────────────────┘            └───────┬────────┘
                                              │ workers pull at rate-limited pace
                    ┌─────────────────────────┼───────────────────────┐
                    ▼            ▼             ▼            ▼           ▼
                 Gmail/SMTP   Twilio/WA   LinkedIn(API/    Social     CRM sync
                 (Nodemailer) (Meta)       Puppeteer)      APIs       (HubSpot)
```

## Core flows

**1. Lead ingestion.** CSV upload → `/api/leads` → validate + dedupe (by email) →
upsert into `leads`. Custom columns become template variables. See
[crm-data-model.md](crm-data-model.md).

**2. Campaign execution.** A campaign is a **node graph** (send / wait / condition /
exit) and each lead is an `Enrollment` that walks it one node at a time
(`lib/campaign-engine.ts`). Steps are *not* enqueued up-front: a single `advance` job
performs the current node's send inline and then schedules the next hop, so branches,
waits and reply-driven stops are all decided at run time. Delays carry jitter and
workers respect per-channel token buckets ([rate-limits.md](rate-limits.md)).

Transport is QStash in production, BullMQ/Redis otherwise (`lib/queue.ts`).

**`Enrollment.nextRunAt` — not the queue — is the source of truth for what is due.**
Because a sequence lives as exactly one in-flight queue message per lead, a single
dropped or rejected publish would otherwise end that lead's sequence silently and
permanently. Two mechanisms close that gap:

- `sweepDueEnrollments()` re-runs any enrollment overdue by >10 min, driven by
  `GET/POST /api/cron/enrollment-sweep` on a 10-minute QStash schedule
  (`scripts/setup-qstash-schedules.ts`). It reads the `@@index([status, nextRunAt])`
  on `Enrollment`, and only considers enrollments whose **campaign is still active**,
  so pausing or finishing a campaign is never undone by a sweep.
- Every run first takes an atomic lease on `nextRunAt` (`claimEnrollment`), so a late
  queue callback and the sweep can never double-send the same node.

A failed enqueue rolls `nextRunAt` back into the past and logs an
`enrollment_enqueue_failed` activity, making the sweep pick it up. Use
`npx tsx scripts/verify-sequence.ts` to see where every enrollment is parked, and
`--sweep` to recover stalled ones by hand.

**3. Sending.** Each channel module exposes a uniform interface
(`send(lead, rendered)`), renders the template ([templates-and-variables.md](
templates-and-variables.md)), performs the send, and writes an entry to `messages` +
`activity_log`.

**4. Inbound / status.** Webhooks (`/api/webhooks/*`) capture bounces, WhatsApp
delivery/quality signals, and replies. A reply or "unsubscribe" adds the lead to the
**suppression list** and halts their remaining sequence steps.

**5. Agent orchestration.** The Claude agent ([ai-agent.md](ai-agent.md)) can drive
campaigns via tools that wrap the same channel modules and CRM — it never bypasses the
rate-limit layer.

## Service boundaries (module contracts)

| Module | Responsibility | Talks to |
|---|---|---|
| `lib/crm` | Lead + campaign + log persistence | Postgres / HubSpot API |
| `lib/channels/*` | One send interface per channel | Provider SDKs, `ratelimit` |
| `lib/domains` | Sending-domain suggestions + DNS verification | Public DoH resolvers |
| `lib/templates` | Render `{{vars}}` + fallbacks | CRM (lead data) |
| `lib/ratelimit` | Token buckets, jitter, ramp, warm-up | Redis |
| `lib/agent` | Claude tool loop + safety stops | channel modules, CRM |

## Non-functional
- **Idempotency:** every enqueued send carries a unique key; workers no-op on
  duplicates (protects against retries double-sending). Campaign hops add a second
  layer — an atomic `nextRunAt` lease per enrollment, so the queue and the recovery
  sweep cannot both run one node.
- **Graceful degradation:** on provider throttle/error, back off + re-queue, never
  hammer.
- **Observability:** structured audit log for every action; alerts on bounce/spam
  spikes and unusual send rates ([security.md](security.md)).

## Open decisions
- HubSpot as system-of-record vs. Postgres-primary with optional HubSpot sync.
- Redis provider on Vercel (Marketplace) for BullMQ.
- Whether LinkedIn browser automation runs in a Vercel Sandbox or a dedicated worker
  host (long-lived session + residential IP considerations).

## Scheduling

**QStash Schedules, registered by `scripts/setup-qstash-schedules.ts`.** They do
not self-register: a fresh environment has no reply polling, no warm-up, no
sweeps and no task reminders until that script is run against production.

Vercel Cron via `vercel.json` was tried and removed. **Hobby plans reject any
cron expression more frequent than daily, and reject it at deploy time** — the
whole deployment fails, not just the cron. This app needs a 5-minute reply
poller, so `vercel.json` is only an option on Pro.

`lib/cron-auth.ts` accepts either a QStash signature or a `CRON_SECRET` bearer,
so both schedulers work and manual `curl` runs do too.

| Path | Schedule |
|---|---|
| `/api/inbox/poll` | every 5 min |
| `/api/cron/domain-sweep` | every 5 min |
| `/api/cron/enrollment-sweep` | every 10 min |
| `/api/cron/sla-sweep` | every 15 min |
| `/api/cron/task-sweep` | every 15 min |
| `/api/cron/daily-digest` | hourly (sends per org at local 8am) |
| `/api/warmup/run` | every 4 h |

Two constraints worth knowing. Vercel cron expressions are **always UTC**, which is
why the digest runs hourly and works out each org's local hour itself rather than
being scheduled for "8am". And **Hobby plans reject anything more frequent than
daily at build time** — this table needs a Pro plan or it will not deploy.

Delivery is best effort: Vercel may miss a run or occasionally fire one twice, and it
never retries a failure. Every sweep is therefore written to be idempotent and to
reconcile from database state rather than assume it ran last time.

`scripts/setup-qstash-schedules.ts` remains as a fallback for non-Vercel hosting.
Running both schedulers doubles the invocations.
