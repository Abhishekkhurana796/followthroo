# enrichment.md — Email and phone from LinkedIn Contact info (P2)

**Last updated:** 2026-09-15
**Status:** desktop 1.15.3. The current plain-text `1st` header badge and
LinkedIn's accessible Contact info dialog shape are covered by the desktop
fixtures. A successful live extraction remains the final confirmation (see
"What's unverified" below).

> Where it fits: [CLAUDE.md](../CLAUDE.md)'s doc index, alongside
> [channels.md](channels.md) and [pricing.md](pricing.md). Credits are the same
> engine pricing.md describes (`lib/billing/meter.ts`) — this doc is about what
> gets charged and merged, not the ledger mechanics themselves.

## What it does

A 1st-degree LinkedIn connection's "Contact info" overlay can carry an email,
a phone number, websites and an "connected since" date that LinkedIn never
otherwise exposes. The desktop app opens it, the same way it sends
invitations — on the customer's own machine, own IP, own logged-in session —
and merges anything found into the CRM.

**Started from four places**, all converging on `lib/linkedin/enrich.ts`:

1. The Leads screen's bulk "Find email & phone" action.
2. A button on the lead record.
3. A campaign's **Find email and phone** step.
4. "Look up contact info when an invitation is accepted" (off by default),
   under LinkedIn → Limits.

## Plan access

Profile enrichment is a **Grow ($20/month) and Scale ($50/month)** feature.
When `BILLING_ENFORCED=1`, lower plans see an upgrade state in Leads and the
campaign builder; the individual and bulk enqueue route, campaign validation,
desktop peek/claim endpoints, and campaign completion path also reject or
skip it server-side. That keeps an old desktop client or a saved campaign from
bypassing the plan boundary.

## The engine (`lib/linkedin/enrich.ts`)

Structurally identical to the invite queue (`lib/linkedin/queue.ts`), because
it is the same kind of thing:

- **One claimer.** `claimEnrichments` is desktop-only, marks a row
  `in_progress` with a single atomic `UPDATE`, and stops handing out lookups
  once the account's `dailyEnrichCap` (150/day default — small on purpose,
  see "Why the cap is so much lower than invites" below) or the workspace's
  credits are exhausted.
- **Credits reserved at claim, settled at completion.** 3 credits, minus 1 for
  each of email/phone LinkedIn doesn't show, refunded in full if the lead
  isn't (or is no longer) a 1st-degree connection, or if the lookup failed
  technically. See `enrichmentCharge` in `lib/billing/plans.ts`.
- **Technical failures retry** up to 3 times (`MAX_ATTEMPTS`) before settling
  as `failed` — a page that didn't load isn't the same thing as "not a
  connection," and shouldn't cost the workspace anything either way until it's
  actually given up on.
- **The CRM merge never overwrites.** An existing email or phone stays the
  lead's primary value; a different one from LinkedIn is added as a
  `ContactIdentity` marked `source: "linkedin_enrichment"` ("also known as" on
  the lead record). With nothing on file, LinkedIn's value becomes the
  primary.

## The campaign step

An `enrich` node (`lib/campaign-engine.ts`) queues a lookup and **parks the
enrollment on that exact node** — no polling, no separate timer job. Two ways
off the park:

- `completeEnrichment` resumes it immediately via `resumeAfterEnrich`, the
  moment the desktop app reports back.
- If nothing resolves it within **7 days**, the next `advanceEnrollment` call
  on that same node (scheduled when the node was first entered) recognizes
  its own re-entry as the timeout firing, marks the stray lookup `skipped`,
  and continues the sequence anyway.

`ConditionNode.on` gained `has_email` / `has_phone`, read live off the lead
(not off enrollment-time state), so `Enrich → has email? → yes: Email / no:
LinkedIn message` is a real, buildable branch.

## Auto-enrich on accept

`recordConnectionsSeen` (`lib/linkedin/queue.ts`) — the same function that
marks an invitation accepted by matching the desktop app's read of the
connections list — now optionally enqueues an enrichment for each match, when
`LinkedInAccount.autoEnrichOnAccept` is on. Off by default: queuing a lookup
for every acceptance would spend a good chunk of the daily cap on people
nobody asked to look up.

## The desktop side

- `desktop/page-actions.js` gained `readContactInfo()`, self-contained like
  `fillLinkedInAction` (no imports, no closure — Playwright serializes it by
  source). It refuses to open anything unless the page shows positive
  evidence of a 1st-degree connection (the same badge/"Remove Connection"
  check `fillLinkedInAction` already uses), clicks the profile's "Contact
  info" link, parses the overlay, and **always closes it again** before
  returning.
- `desktop/enrich-flow.js` is the lookup loop: claim → navigate → read →
  report, at 6–15 seconds apart — gentler pacing than invites, because the
  cap here is so much higher. It stops on 3 consecutive failures or a login
  wall, the same discipline `runner.js` holds invites to.
- The desktop UI exposes this as its own **Profile enrichment** lane. It has a
  separate peek endpoint and Start button; invitation sending never claims or
  starts enrichment work, and enrichment never claims an invitation.
- Selector recovery is deterministic: Playwright clicks the current profile's
  top-card Contact info link first and waits for LinkedIn's visible accessible
  dialog; the documented `/overlay/contact-info/` route is a second fallback.
  The Contact-info step does not use an AI click decision, so a visible dialog
  cannot be mistaken for an assistant-selector failure.
- The **Activity** panel writes the same useful run trace as connection sends:
  it records the profile opening in Playwright, the exact degree evidence,
  which Contact info route was tried, the extraction result, and confirmation
  that Followthroo received the outcome. The identical records remain local in
  the desktop app-data `logs/enrich-run-*.jsonl` file for debugging. They never
  include the pairing token or LinkedIn session cookie.

### Why the cap is so much lower than invites

Degree detection now reads current profile badges, the current plain-text
`1st` header text beside pronouns, accessible labels, then the explicit
**Remove Connection** action. It returns the detected degree and
diagnostic evidence. With no positive 1st-degree evidence it records a safe
`degree_unverified` skip; known 2nd/3rd degrees record `degree_not_first`.
Only the deterministic Playwright Contact info path runs after an eligibility
decision, so an eligibility skip cannot be reinterpreted as a selector miss.

`dailyInviteCap` defaults to 20; `dailyEnrichCap` defaults to **150**. That
looks backwards until you notice what each action actually is: an invitation
is a rare, deliberate gesture LinkedIn expects a human to make a handful of
times a day. Opening dozens of profiles' Contact info back-to-back is exactly
the shape of behavior LinkedIn's abuse detection watches for — "reads a lot
of profiles fast" is the signature of a scraper, sent or not. 150 is meant to
sit well below the point that gets noticed, not to be the largest number that
technically still works.

### What's unverified

`readContactInfo` accepts both the older `.pv-contact-info` shape and the
current visible accessible dialog (`role="dialog"` / `aria-modal`), then reads
its `.ci-email`, `.ci-phone`, `.ci-websites`, and `.ci-connected` values. The
fixtures exercise both the degree header and accessible dialog, but a first
successful live extraction is still required because LinkedIn can change the
overlay markup or profile-link URL without notice.

## Verification

`scripts/verify-linkedin-enrichment.ts` — claiming against the daily cap,
what each outcome costs, technical-failure retries, the CRM merge (both
"already had one" and "had nothing"), a campaign's Enrich step parking and
resuming an enrollment, and the 7-day timeout, simulated by fast-forwarding
`nextRunAt`. Run with `npx tsx --env-file=.env scripts/verify-linkedin-enrichment.ts`.

`scripts/verify-linkedin-enrichment-selectors.ts` drives the current degree
header and accessible Contact info dialog fixtures. It does not use a real
LinkedIn account; a successful live extraction remains the final check.
