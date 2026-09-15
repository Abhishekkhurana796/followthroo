# crm-data-model.md — Data Model, CRM, Import/Export

**Last updated:** 2026-09-10
**Status:** draft

> Either Postgres-primary (custom CRM) or HubSpot as system-of-record with sync.
> Docs assume Postgres-primary; HubSpot-parity API mirrors HubSpot's contact model.

---

## Entities

### `leads`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `first_name`, `last_name` | text | |
| `email` | citext (unique) | dedupe key on import |
| `phone` | text — see docs/security.md for what is and is not encrypted | E.164; needed for WhatsApp |
| `linkedin_url` | text | |
| `company`, `title` | text | |
| `stage` | enum | `new · contacted · replied · qualified · won · lost` |
| `tags` | text[] | |
| `custom` | jsonb | extra CSV columns → template variables |
| `opted_out` | bool | global suppression |
| `consent` | jsonb | per-channel opt-in + timestamp (GDPR) |
| `created_at`, `updated_at` | timestamptz | |

### `campaigns`
`id`, `name`, `status (draft/active/paused/done)`, `sequence` (jsonb: ordered steps
with channel, template_id, wait), `created_by`, `archived_at`, timestamps.

**Deleting** (`DELETE /api/campaigns/[id]`, owner/admin) stops live enrollments and cancels
queued LinkedIn actions in one transaction. A campaign that never sent anything is removed;
one with sent messages or invitations gets `archived_at` instead and drops out of every
list, so the Inbox, Outbox and Reports can still name it. `?dryRun=1` returns the counts the
confirm dialog shows.

### `messages`
`id`, `lead_id`, `campaign_id`, `channel (email/linkedin/whatsapp/social)`,
`template_id`, `rendered_subject`, `rendered_body`, `status (queued/sent/delivered/
bounced/replied/failed/draft)`, `provider_id`, `sent_at`, `idempotency_key (unique)`,
`kind (message/invite)`, `sent_by_user_id`.

A LinkedIn connection request is written here with `kind: invite` so the timeline sees
it. The Outbox (`/api/outbox`) lists `kind: message` rows as sent messages and reads
invitations from `linkedin_actions`, which carry `kind` and `accepted_at`. "Sent by"
reads, in order: the campaign; otherwise `sent_by_user_id` (a reply typed in the Inbox,
which now writes a Message too); otherwise the AI agent.

### `inbox_messages` attribution
`campaign_id` is the campaign that sent an outbound message, or the one an inbound
message answers — set only on a header or thread match, because an address match is a
new message and naming a campaign there would claim a reply that never happened.
`in_reply_to_message_id` is the Message a header match answers; `sent_by_user_id` is an
Inbox reply's author. WhatsApp and LinkedIn carry no reply headers, so those threads say
which campaign last contacted the person instead, worded as exactly that.
`scripts/backfill-outreach-attribution.ts` fills all of this for older rows.

### `activity_log`
`id`, `lead_id`, `campaign_id`, `type (sent/opened/clicked/delivered/bounced/replied/
invite_accepted/unsubscribed)`, `channel`, `meta` (jsonb), `at`. Powers analytics +
troubleshooting.

### `suppression`
`email`/`phone`/`linkedin_url`, `reason (unsubscribe/bounce/gdpr/manual)`, `at`.
Checked before every send, globally.

### `tasks`
One owed action against one lead. Deliberately *not* a project-management object —
no subtasks, no dependencies, no projects. It exists so a lead cannot fall through.

| Field | Type | Notes |
|---|---|---|
| `id` | cuid (pk) | |
| `organization_id` | text | tenant scope (required — new table, no legacy rows) |
| `lead_id` | text (fk, nullable) | cascade on lead delete |
| `pipeline_item_id` | text | which deal it belongs to, when there is one |
| `title` | text | |
| `kind` | enum | `follow_up · call · email · whatsapp · linkedin · meeting · other` |
| `status` | enum | `open · done · cancelled` |
| `due_at` | timestamptz (nullable) | null = accepted work with no deadline |
| `owner_id` | text | raw userId; memberships are per-org and change |
| `created_kind` | text | `user · ai · system` — keeps "we made this for you" visible |
| `completed_at`, `created_at`, `updated_at` | timestamptz | |

Buckets (`lib/tasks.ts`): **Overdue** `due_at < today`, **Today** `due_at` within
today **or null**, **Upcoming** `due_at > today`, **Done**. An undated open task
surfaces in Today rather than nowhere — otherwise it is never seen again.

### `notes`
`id`, `organization_id`, `lead_id`, `author_id`, `body`, `created_at`. A human's own
words, internal only. Separate from `conversation_events`, which is reserved for
things that actually happened on a channel.

> **Merge safety:** both tables cascade on lead delete, so `mergeLeads()` in
> `lib/identity.ts` **must** repoint them onto the survivor before the duplicates are
> removed. `scripts/verify-v3.ts` guards this.

## Next action

Every active lead answers "what do I do next?" — from a real `task` when one exists,
otherwise *derived* from state the app already holds. Derivation matters: without it
the column is blank on day one for every existing contact. Precedence
(`nextActionsFor` in `lib/tasks.ts`, batched — one page of 50 costs a fixed handful
of queries, not 200):

1. open `task` with the earliest `due_at`
2. latest `conversation_event` is inbound → **"Reply now"** (urgent)
3. `pipeline_item.sla_breached_at` set → **"Overdue in {stage}"** (urgent)
4. `stage = new` and no outbound event ever → **"Contact"**
5. otherwise nothing owed → UI reads "Waiting"

An `opted_out` lead is never given a next action, whatever else is true.

**Auto-creation:** `recordConversationEvent()` creates a system follow-up when an
inbound event lands and no open task exists for that lead. It sits there, not in each
adapter, because every channel writes through it — so email, WhatsApp and the ingest
path all get follow-ups for free. Idempotent: a chatty contact owes one thing, not one
per message.

## CRM API (HubSpot-parity CRUD)
```
POST   /api/leads              create (upsert by email)
GET    /api/leads              list — rows enriched with source, owner,
                               last activity and next action
GET    /api/leads/:id          the full record: identities, open tasks,
                               pipeline position, live sequences, next action
GET    /api/leads/:id/timeline merged history (see below)
PATCH  /api/leads/:id          update
DELETE /api/leads/:id          delete (GDPR)
POST   /api/leads/associate    link lead ↔ campaign/activity

GET    /api/tasks?view=buckets Overdue / Today / Upcoming / Done
POST   /api/tasks              create
PATCH  /api/tasks              complete · reopen · update
DELETE /api/tasks?id=          delete
POST   /api/notes              add a note
DELETE /api/notes?id=          delete
GET    /api/home               action-first dashboard payload
```
(Mirrors HubSpot v3 `POST /crm/v3/objects/contacts` semantics for easy sync.)

## Unified timeline

`GET /api/leads/:id/timeline` merges five tables into one descending feed of
`{ id, at, kind, channel, direction, title, body, actor }`:

| Source | `kind` |
|---|---|
| `conversation_events` | `message` |
| `activity_log` | `activity` |
| `stage_transitions` (via the lead's pipeline items) | `stage` |
| `notes` | `note` |
| completed `tasks` | `task` |

The UI never needs to know which table an entry came from — that is the entire point
of the unified record. It paginates separately from the lead bundle so opening a
contact with years of history stays cheap.

## CSV / Excel import
Leads → Add Lead → **Import CSV or Excel**. The tab lists the columns it understands and offers a
sample file, both from `IMPORT_COLUMNS` / `SAMPLE_CSV` in
`app/dashboard/leads/LeadsClient.tsx`, which mirror `normalizeRow` in
`app/api/leads/import/route.ts` — change them together.

| Column | Also accepted | Notes |
|---|---|---|
| `email` | | dedupe key; this **or** a LinkedIn URL is required per row |
| `linkedin url` | `linkedin`, `linkedin profile`, `profile url` | dedupe key for rows with no email |
| `first name`, `last name` | `name` (split on the first space) | |
| `company`, `title`, `phone` | | |
| `tags` | | comma-separated |

- CSV is parsed with **PapaParse**; `.xlsx` reads the first worksheet. Headers match case- and space-insensitively, and both formats use the exact same columns.
- Unknown columns land in `custom` jsonb and become `{{Column name}}` template
  variables ([templates-and-variables.md](templates-and-variables.md)).
- A row with neither email nor LinkedIn URL is skipped with its reason; the dialog shows
  the first three reasons. Never silently drop.
- Imported leads get the `csv` source, the importer as `created_by` (`created_kind:
  import`), and an owner from that source's assignment rule.

## CSV / report export
- In **Leads**, combine search, tag, group, stage, owner, source, and LinkedIn filters, then choose **Export CSV**. The export uses the exact same authorized scope and filters as the table; it is never a workspace-wide bypass.
- The CSV includes standard contact fields, tags, source, created date, and every custom CSV-import column found in the selected result. It opens correctly in Excel because it includes a UTF-8 BOM and quotes every cell.
- Respect RBAC — raw PII export is owner/admin-only ([security.md](security.md)).

### Import-ready CSV / Excel format

Use a header row and one person per following row. Each person needs an `email` **or** a `linkedin url`; the other fields are optional. Header capitalization and spaces do not matter, and unknown columns are retained as variables you can use in templates.

For `.xlsx`, put this header row on the first worksheet; extra worksheets are ignored.

```csv
first name,last name,email,linkedin url,company,title,phone,tags,city
Priya,Shah,priya@acme.com,https://www.linkedin.com/in/priyashah,Acme,Head of HR,+91 98765 43210,"warm,hr",Mumbai
Arjun,Mehta,,https://www.linkedin.com/in/arjun-mehta,Globex,Talent Lead,,linkedin,Pune
```

## External CRM sync (optional)
- Push new leads + log outreach as activities to HubSpot/Salesforce via their API or
  Zapier. Keep `provider_id` mapping for two-way sync.

## Sending domains

Added 2026-08-23 with the reseller-storefront flow
([domains-and-mailboxes.md](domains-and-mailboxes.md)).

| Model | Purpose |
|---|---|
| `Domain` | One sending domain per workspace, scoped by `@@unique([organizationId, name])`. `nextCheckAt` + `@@index([status, nextCheckAt])` drive the verification sweep — the DB decides what is due, the queue is only transport. `status`: `dns_pending → active`, or `failed` / `expired`. |
| `DomainDnsRecord` | One expected record (MX / SPF / DMARC, plus DKIM once a selector is issued) plus `observedValue` — what a public resolver actually returned last check. Unique on `[domainId, kind, host]` so verification upserts rather than duplicating. |

`SendingAccount` gained two fields: `domainId` (nullable FK, `onDelete: SetNull`)
and a third `provider` value, `"managed"`, for a mailbox bought through us.
Nothing downstream branches on either — a managed mailbox is an ordinary sending
account, which is why warm-up, the reply poller, deliverability scoring and
`safeSend` all kept working untouched.

`createdById` records the teammate who connected a mailbox. Members can use only
their own account for campaigns, agent sends, template tests, inbox replies, and
warm-up; owners/admins retain mailbox administration. This prevents one rep from
sending as another rep just because both accounts share a workspace.

There is deliberately **no order or payment table**: the storefront takes the
money and credits us the margin.

## Tasks: assignment, priority, reminders

Added 2026-08-24. The `Task` model was always capable of this; the UI simply
never used it.

| Field | Why |
|---|---|
| `priority` | `TaskPriority` enum, `none` by default. Ordered low-to-high so `orderBy: { priority: "desc" }` sorts the way a human expects, and `listTasks` ranks by it *before* the due date — otherwise setting a priority changes nothing you can see. |
| `instruction` | Free text for whoever picks the task up. Distinct from `Note`, which is a human's words about the **contact**. |
| `remindedAt` | The one nudge to the owner. Null-guarded, and **released again if the email fails**, so a transient SMTP outage does not silently consume the only reminder a task gets. |
| `escalatedAt` | The one escalation to the owner's manager. Mirrors `PipelineItem.slaBreachedAt`, including the choice not to retry: the `EscalationEvent` records honestly that nothing was delivered rather than re-sending every 15 minutes. |

`@@index([status, dueAt])` was added because the reminder sweep runs across every
org, and the existing indexes are all org-scoped.

**`EscalationEvent` now carries either kind of late work.** `itemId` became
nullable and `taskId` was added; exactly one is set, enforced by the two callers
since Prisma cannot express it. This reuses the whole `/dashboard/escalations`
screen — including its "actually delivered" counter — rather than building a
second one.

### Notification delivery checks

Task assignment emails send immediately; due reminders run every 15 minutes and the
daily digest runs hourly (delivering at 8am in each workspace's local time). Run
`npm run check:task-notifications` to confirm the two QStash jobs target
`https://app.followthroo.com`; it is read-only and never prints credentials. A digest
is claimed before it sends to prevent duplicates, but its claim is released if SMTP
fails so a later sweep can retry. Platform SMTP (`SMTP_HOST`, `SMTP_USER`, and
`SMTP_PASS`) must be configured in the deployed environment for email delivery;
in-app notifications remain available independently.

**`User` gained** `notificationPrefs Json?` and `lastDigestAt DateTime?`. Both
nullable with no default, for the same reason as the other app-owned user fields:
better-auth owns that table and a non-nullable addition reads as drift.
