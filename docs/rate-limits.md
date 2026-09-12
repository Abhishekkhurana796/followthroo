# rate-limits.md — Quotas & Throttling Strategy

**Last updated:** 2026-09-12
**Status:** draft

> Rate limits are law (see CLAUDE.md guardrails). Every send acquires quota from
> `lib/ratelimit` before firing. On quota exhaustion, re-queue — never burst.

---

## Consolidated quota table

| Channel / API | Starting limit | Scaling / ceiling | Extra caps |
|---|---|---|---|
| **Gmail (free/trial)** | 500 messages/day | — | ≤500 recipients/msg; rolling 24h; freezes ~24h on breach |
| **Gmail (paid Workspace)** | ~2,000 messages/day | — | ~3,000/day to external recipients |
| **LinkedIn invites** | ~20/day (new account) | ramp +~5/week with acceptance | hidden caps → "Try again next week" |
| **LinkedIn invite notes** | 3/day on a free account | any invite on Premium / Sales Navigator, up to the invite cap | a Premium upsell replaces the note box → the day's notes close early (`noteAllowance`, `notesExhaustedOn`) |
| **LinkedIn API calls** | per approved plan | up to ~100,000/day (approved) | TOS forbids exceeding limits |
| **WhatsApp (portfolio)** | 250 unique users/24h | 250 → 2,000 → 10,000 → 100,000 after verification/quality | template + opt-in required outside 24h window |
| **Mailgun API** | 500 calls / 10s | — | chunk bursts |
| **Twilio / others** | per-second quotas | — | respect provider docs |

---

## Throttling primitives (`lib/ratelimit`)

1. **Token buckets per channel per account.** Refills at the safe sustained rate
   (e.g. email ~40/hour). A send must take a token or the job re-queues.
2. **Jitter.** Add **30–90s** random delay between actions (or 10–30% of the base
   interval) so patterns aren't robotic.
3. **Ramp schedules.** New accounts start low and increase weekly (esp. LinkedIn
   ~20/day → +5/week), gated on positive signals (acceptance rate, low bounce).
4. **Warm-up ("burn-in").** New email domains / LinkedIn / WhatsApp accounts start
   with light, high-quality activity before full volume.
5. **Rolling-window counters.** Track unique WhatsApp recipients and daily email/invite
   counts in a 24h window (Redis); stop at the cap, resume next window.
6. **Backoff on provider errors/throttle.** Exponential backoff + re-queue; never retry
   in a tight loop.

## Safety stops (auto-pause a campaign when…)
- Bounce rate or spam-complaint rate crosses a threshold.
- LinkedIn returns "out of invites" / restriction signals.
- WhatsApp quality rating goes negative.
- A hard provider "limit reached" error is seen.

## Scheduling defaults (tune per account reputation)
| Channel | Default pace |
|---|---|
| Email | ~10–20/hour (max ~40/hour), spread across the day |
| LinkedIn invites | ~10/hour, ≤ daily ramp cap |
| WhatsApp | within 250/24h, spaced with jitter |

## Anti-spam companions
- Spam-score check on template content before send; flag risky copy.
- Suppression list honored globally (opt-out, reply "unsubscribe", GDPR delete).
- SPF/DKIM/DMARC on sending domains ([security.md](security.md)).

## Warm-up (Phase 2)
- Mailbox warm-up ramps from **2/day → configurable daily target (default 6)** over `rampDays`
  (default 21) per mailbox — `lib/warmup.ts`, config in `Warmup` model. Warm-up sends bypass
  the campaign rate limiter and are not tracked (no pixels). Placement (inbox vs spam) and
  spam-rescue are recorded as `WarmupEvent`s and surfaced on `/dashboard/deliverability`.
