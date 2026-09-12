# pricing.md — Plans, Credits & the Costs Behind Them

**Last updated:** 2026-09-12
**Status:** draft

> **The source of truth is [`lib/billing/plans.ts`](../lib/billing/plans.ts).**
> Prices, limits, daily credits, what each action costs and the top-up packs
> live there once; the pricing page, Plans & billing, `llms.txt`, the FAQ and
> every limit check read it. If this doc and that file disagree, the file is
> right and this doc is stale.
>
> The first half is the pricing as settled with the client on 2026-09-12 and
> how the product enforces it. The second half is the cost model it has to
> clear. [pricing-model.xlsx](pricing-model.xlsx) and
> [pricing-model-blended.csv](pricing-model-blended.csv) model the earlier
> per-seat ₹ tiers and predate credits.

---

## The plans (settled 2026-09-12)

All prices in USD, charged through Razorpay. Dodo Payments was considered and
declined on fees: 4% + 40¢ against Razorpay's ~2%.

| | Test Drive | Start | Grow ⭐ | Scale | Custom |
|---|---|---|---|---|---|
| Price | $2 one-time, 14 days | $10/mo | $20/mo | $50/mo | Talk to us |
| **Credits a day** | 30 | 100 | 250 | 750 | — |
| People | 1 | 1 | 2 | 5 | 5+ |
| Sending inboxes | 1 | 1 | 2 | 5 | — |
| Campaigns | 1 | 3 | 10 | 25 | — |
| Templates | 3 | 10 | 25 | 50 | — |
| Leads stored | 50 | 500 | 2,500 | Unlimited | — |
| Post autopilots | — | 1 | 3 | 10 | — |
| Deliverability report | — | ✓ | ✓ | ✓ | |
| Lead assignment | — | just you | ✓ | ✓ | |
| Roles, control tower, ageing | — | — | ✓ | ✓ | |
| Escalations / SLA rules | — | — | — | ✓ | |
| Premium AI models | — | — | ✓ | ✓ | |

Extra seats can't be bought; more than five people is a Custom plan. Credits
meter actions; storage stays capped. There is no "leads added per month" limit
and no lead top-up.

**Why a plan beats top-ups.** Plans show credits a day and packs show a total,
which made a $5 pack look cheaper than a $10 plan. Per credit it's the other way
round: Start's credits cost $0.0033, Grow's $0.0027, Scale's $0.0022, and packs
$0.005–$0.010 — about 3× a plan's own rate. The pricing page and Billing print
both numbers side by side for that reason.

### Credits

| Action | Credits |
|---|---|
| Email sent | 1 |
| LinkedIn invitation | 3 |
| LinkedIn invitation with a note | 5 |
| LinkedIn message | 2 |
| Enrichment (LinkedIn Contact info) | 3, less 1 per missing email/phone; all 3 back if not 1st-degree or on failure *(P2)* |
| WhatsApp / SMS, on the customer's own number or provider | 1 |
| AI reply draft / agent step | 2 |
| AI post, research + write | 10 standard model · 20 premium, per variant *(P3)* |
| LinkedIn import with the extension | 1 per 10 people added |
| CSV import, adding leads, CRM, inbox (including replying by hand), reports, test sends to yourself | Free |

- **A daily allowance.** It refills at midnight in the workspace's time zone
  (the business-hours offset, IST by default) and doesn't roll over. One pool
  per workspace.
- **Today's allowance first, then top-ups.** Top-ups never expire while the
  workspace has a plan, and are lost on cancellation. Paid plans only.
- **Taken when something goes out.** Credits are reserved when an action
  starts and settled when it finishes: kept if it happened, handed back if it
  didn't. A skipped, failed or rate-limited send costs nothing.
- **Out of credits, nothing is lost.** A campaign step waits for the next
  midnight; a LinkedIn invitation stays queued as "Waits for credits"; an
  import brings in what the balance covers. The workspace sees a banner, and
  its owners and admins get one email a day.

### Top-ups and auto-recharge

500 for $5 · 1,500 for $12 · 5,000 for $30 · 15,000 for $75.

Auto-recharge is a Razorpay card/UPI mandate the customer approves once with a
monthly ceiling. When the balance drops below their threshold we charge the
pack they chose. Indian cards need a pre-debit notice, so credits arrive about
a day after the trigger.

### Launch

Every workspace that existed before billing gets **14 days of Grow**, counted
from the first time somebody opens it after launch
(`startTrialIfWaiting`, called from `app/dashboard/layout.tsx`), so a dormant
workspace's trial can't run out unseen. Reminders go at 7, 3 and 1 days left and
when it ends. After that, sending, enrichment and posting stop until a plan is
chosen. Nothing is deleted, and a workspace over its new limits chooses what
stays active.

---

## How it's enforced

| Piece | Where |
|---|---|
| Plans, limits, costs, packs | `lib/billing/plans.ts` |
| The ledger: allowance, reserve, settle, top-ups | `lib/billing/credits.ts` — `CreditBalance` + append-only `CreditLedger` |
| What a charge means: billing on or off, refusals, the once-a-day email | `lib/billing/meter.ts` |
| Plan status, trials, Test Drive expiry | `lib/billing/subscription.ts` |
| Create-time limits (402 when enforced) | `lib/billing/limits.ts`, called from the campaign, template, lead, import and mailbox routes |
| Billing screens | `lib/billing/summary.ts` → `/api/billing/summary`, `/api/billing/history` |
| Stranded reservations, trial reminders | `lib/billing/sweep.ts` → `/api/cron/billing-sweep` (QStash, every 15 min) |
| Payments (Test Drive, packs) | `lib/billing/razorpay.ts` (REST + signatures), `/api/billing/checkout` → Razorpay Checkout → `/api/billing/verify` → `lib/billing/payments.ts` |
| Plan features on screens | `upgradeFor` → `PlanUpsell` on Deliverability, Ageing, Escalations, Control tower; `requireFeature` on lead assignment |
| People and roles | `organizationHooks` in `lib/auth.ts`: a seat check on invite and join (pending invitations hold a seat), and the roles feature |
| Choose what stays active | `/api/billing/keep-active` + `KeepActiveDialog`; a read-only seat is refused writes in `requireOrg` |
| Launch trials | `scripts/billing-launch.ts` (dry run by default, `--apply` to write) |

**Where credits are charged.**

- Email and WhatsApp: in `safeSend`, before the rate limiter, so a refused
  send doesn't use an hour's quota and a rate-limited one gets its credit back.
  Callers pass `SendContext.free` only for sends a person makes by hand for
  themselves (inbox replies, template test sends).
- LinkedIn: when `claimActions` hands an action to the desktop app, settled in
  `completeAction`. An action put back in the queue (closed browser, the note
  upsell) keeps its credits. One cancelled without a report (deleted campaign,
  "Stop everything") is settled by the sweep.
- Sourcing: `importScrapedRows`. The agent: `paidStep` in `lib/agent.ts`.

**Invariants.** The balance can never go negative: a charge is one conditional
`UPDATE`, never a read then a write (`claimActions` has that race and credits
must not inherit it). Every movement is a ledger row unique on
`(refType, refId, kind, bucket)` under a per-thing advisory lock, so retries and
redelivered webhooks move credits once. Reserving a ref that was already
settled charges nothing, so anything that can be retried after it finished
needs a ref per attempt.

**The switch.** Nothing is charged or refused until `BILLING_ENFORCED=1`.
Before the launch script gives workspaces a plan, "no plan" would refuse every
send. With it off, limit checks log what they would have refused, and the
credits chip and banners stay hidden.

`scripts/verify-credits.ts` holds all of this to account against throwaway
workspaces.

---

## What's actually running (as of this branch)

| Layer | Provider | Notes |
|---|---|---|
| Hosting | Vercel (Fluid Compute) | `.vercel/project.json` confirms the connection; no `vercel.json` yet |
| Database | Supabase Postgres | Pooled `:6543` (runtime, pgbouncer) / direct `:5432` (migrations) |
| Queue (prod) | Upstash QStash | `lib/queue.ts`: QStash → inline (dev only) |
| Rate-limit counters | Upstash Redis | Required in prod so counters are shared across workers (`lib/ratelimit.ts`) |
| Email | Nodemailer + Gmail OAuth2 / Zoho / SMTP | BYO mailbox per tenant, no shared fallback |
| WhatsApp | Twilio / Meta, on the customer's own number | Needs creds to go live |
| LinkedIn | Desktop app (`desktop/`) sends; extension sources | Runs on the customer's machine and IP |
| AI | OpenRouter (`OPENROUTER_MODEL`), Anthropic direct as a fallback | `docs/ai-agent.md` |
| Auth | `better-auth`, self-hosted | Email/password + Google + org plugin |
| Billing | **Plans, credits, limits and one-time payments built** | `lib/billing/`. Razorpay test keys are set (`RAZORPAY_API_KEY`, `RAZORPAY_SECRET`); monthly subscriptions, the webhook and auto-recharge are not built yet. |

---

## Current unit pricing

Pulled live on 2026-08-14 — re-verify before finalizing anything against these
numbers, since infra and platform pricing drifts.

| Item | Rate | Source |
|---|---|---|
| Claude Opus 5 (`claude-opus-5`) | $5.00 / $25.00 per MTok (input/output) | Anthropic API pricing |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 / $5.00 per MTok (input/output) | Anthropic API pricing |
| Vercel Pro | $20/seat/month, includes a matching $20 usage credit; 1TB transfer + 10M edge requests free | Vercel pricing, Aug 2026 |
| Supabase Pro | $25/month base + $10 compute credit; real-world small/medium apps land $35–75/mo | Supabase pricing, Aug 2026 |
| Upstash Redis | $0.20 / 100K commands + $0.25/GB storage | Upstash pricing, Aug 2026 |
| Upstash QStash | $1 / 100K messages + $0.25/GB storage | Upstash pricing, Aug 2026 |
| Meta WhatsApp (India, per-message) | Marketing ₹0.863, Utility ₹0.115, Authentication ₹0.115. Service replies free today — **chargeable (₹0.115) from Oct 1, 2026** | Meta rate card, Aug 2026 |
| Twilio WhatsApp markup | $0.005 flat per message | Twilio pricing, Aug 2026 |
| Razorpay | ~2% domestic (first three months free for this account), plus the subscription fee on recurring billing | Razorpay, Sep 2026 |

---

## Recurring cost model

### A. Fixed platform infra

Scales with total data/traffic across all tenants, not per workspace.

| | Pilot (~10 orgs) | Early growth (~40 orgs) |
|---|---|---|
| Vercel | $40–60/mo | $150–350/mo |
| Supabase | $35–60/mo | $100–250/mo (bigger compute + PITR backups) |
| Upstash (Redis + QStash) | $5–20/mo | $40–120/mo |
| Monitoring (not yet added — recommend Sentry) | $0 (defer) | $26–80/mo |
| **Total** | **~$85–225/mo** | **~$290–830/mo** |

### B. What each credit has to cover

A credit sells for $0.0022–$0.0033 inside a plan and $0.005–$0.010 in a pack.

- **Email — ~$0.** Every send goes through the customer's own mailbox.
- **LinkedIn — ~$0 server-side.** The desktop app runs on the customer's machine.
- **WhatsApp / SMS — ~$0 to us** while it's the customer's own number or
  provider paying Meta/Twilio. If we ever resell messaging on our own account,
  1 credit is far below a ₹0.55–1.30 message and the price has to change first.
- **AI — the one to watch.**
  - An agent step is roughly 3K tokens in and 300 out. On a standard
    OpenRouter model (MiniMax M2 class, ~$0.30/$1.20 per MTok) that's about
    $0.001–0.002, comfortably inside 2 credits.
  - On an Opus-class model it's about $0.02, roughly 4× what 2 credits
    bring in.
  - AI posts add web search and longer output: 10 credits (~$0.027) covers a
    standard model; premium at 20 is thin.
  - Keep `OPENROUTER_MODEL` on a standard-tier model, or raise the premium
    prices before offering Opus-class models.
- **Payment processing** — ~2–4% of collected revenue.

At early-growth infra (~$290–830/mo), roughly 40–80 paying workspaces on Grow
cover the platform. After that, margin is decided by which AI models are
offered, not by sends.

---

## Gaps to close before this is chargeable

Done (2026-09-12):

- The $2 Test Drive and top-up packs through Razorpay Checkout, verified by
  signature and granted once. The account accepts USD orders.
- A top-up brings campaign steps waiting for credits forward, instead of
  leaving them until midnight.
- The launch script, plan gates on reports, lead assignment, seats and roles,
  "Choose what stays active", and the credit estimate before a campaign launch.

Still open:

1. **Monthly plans (Start, Grow, Scale):** these are Razorpay subscriptions.
   The test account answered 401 to the Plans API, so Subscriptions has to be
   switched on in the Razorpay dashboard. After that, create the three monthly
   USD plans and add their IDs to the environment. Until then, monthly plans
   are set up by hand.
2. **The webhook** (`payment.captured`, `subscription.*`): register
   `https://app.followthroo.com/api/billing/razorpay/webhook` in Razorpay and
   set `RAZORPAY_WEBHOOK_SECRET`. One-time payments don't depend on it, because
   Checkout's signature is verified directly.
3. **Auto-recharge:** a card/UPI mandate needs Recurring Payments on the
   Razorpay account.
4. **Going live:** run `scripts/billing-launch.ts --apply`, then set
   `BILLING_ENFORCED=1`.
5. **Inbound leads when storage is full:** webhook leads are still accepted
   over the cap, so a customer's enquiry is never lost. Confirm that's intended.
6. **Charge points for P2 (enrichment) and P3 (AI posts)** as those ship.
