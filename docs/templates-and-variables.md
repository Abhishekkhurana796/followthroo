# templates-and-variables.md — Template Engine, Variables, Sequencing

**Last updated:** 2026-07-03
**Status:** draft

> Personalization is the point: personalized messages get replies; generic ones get
> ignored. One template flexes to thousands of leads via variables + fallbacks.

---

## Engine
- **Handlebars** (or Mustache) for `{{variable}}` substitution — unlimited custom
  variables from imported CSV columns.
- Rendered per-lead at send time by `lib/templates` using `leads` data
  ([crm-data-model.md](crm-data-model.md)).

## Variables
**Defaults:** `{{firstName}}`, `{{lastName}}`, `{{company}}`, `{{title}}`, `{{email}}`.
**Custom:** any CSV column → variable (e.g. `industry`, `painPoint` →
`{{industry}}`, `{{painPoint}}`). Stored in `leads.custom` jsonb.

**Fallbacks (required):** use `{{firstName|there}}` syntax so missing data still reads
smoothly — never ship "Hi ," or "Hello {{firstName}}". Every template must define
fallbacks for any non-guaranteed field.

## Email template attachments

Email templates may carry up to five private attachments, 10MB each: PDF, Office files,
ZIP, CSV, text, or JPEG/PNG/WebP images. Add them in **Templates → New template** or
while editing an email template. A campaign step sends the file set of its selected
template; LinkedIn, WhatsApp, and social templates do not accept files.

Attachments are stored as private Blob objects, retrieved only while the server sends
the message, and included in the template-version snapshot. That means an active campaign
keeps the original attachment set unless you explicitly choose to update that campaign.
SMTP and Gmail OAuth mailboxes support attachments. Zoho OAuth templates with files are
blocked with a clear error until its attachment API path is implemented; no email is sent
without the requested file.

## Authoring & safety
- **Preview** with sample data before send; render each variable substituted.
- **Test send** to yourself to catch broken merges.
- **Spam-score check** on content before a batch goes out ([rate-limits.md](rate-limits.md)).
- Conversational tone; subject line + body both support variables. LinkedIn/WhatsApp
  use the same variable system (WhatsApp templates need Meta pre-approval).

### Example (email)
```
Subject: Quick idea for {{company|your team}}

Hi {{firstName|there}}, I noticed {{company}} is innovating in
{{industry|your field}}. It reminds me of work we did at XYZ Corp — could we
connect and share ideas?
```

## Sequences
A campaign is an ordered list of steps with **wait conditions**:
```jsonc
[
  { "channel": "email",    "template": "intro",     "wait": "0d" },
  { "channel": "email",    "template": "followup1", "wait": "2d", "unless": "replied" },
  { "channel": "linkedin", "template": "connect",   "wait": "3d", "unless": "replied" },
  { "channel": "whatsapp", "template": "nudge",     "wait": "2d", "onlyIf": "phone_opt_in" }
]
```
- Executed via **BullMQ** delayed jobs, each gated by `lib/ratelimit`.
- **Triggers/branches:** skip/advance on opens, clicks, replies, invite-accepted.
- A reply or unsubscribe halts the lead's remaining steps and adds them to suppression.

## Storage
Templates: `id`, `channel`, `name`, `subject`, `body`, `variables[]` (declared +
required fallbacks), `updated_at`. Sequences live on `campaigns.sequence` jsonb
([crm-data-model.md](crm-data-model.md)).
