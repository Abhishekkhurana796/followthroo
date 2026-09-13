# posts.md — AI-written LinkedIn posts and Autopilot (P3)

**Last updated:** 2026-09-13
**Status:** draft — backend and UI built; the OpenRouter web-search plugin and
LinkedIn's image-upload endpoint are unverified (see "What's unverified").

> Doc index: [CLAUDE.md](../CLAUDE.md), alongside [enrichment.md](enrichment.md)
> and [pricing.md](pricing.md) for the credit engine these charges run through.

## What it is

**Posts**, a new row under Automate (`/dashboard/posts`), for writing and
scheduling posts to a member's own LinkedIn feed through the official API
(`w_member_social`, already used for manual posting — see
`docs/channels.md`'s LinkedIn OAuth section). Text plus one optional uploaded
image. Instagram is a "coming soon" switch on the same screen, with a
"Notify me" that writes to `ProductInterest` — nothing else exists for it yet.

**Autopilot** lives inside Posts, not the campaign builder — it isn't outreach
to a lead, it's standing work against your own feed. Each one: a search query
and hashtags for finding topics, a brief/tone, a curated model, a schedule,
and a mode (`review` — a draft is created ahead of the slot and must be
approved; `auto` — publishes on schedule, no human step, always exactly one
variant).

## The pieces

| File | What it does |
|---|---|
| `lib/posts/models.ts` | The curated model list (`POST_MODELS`) — id, tier, which `CREDIT_COSTS` key it charges. Nothing outside this list can be selected; `requireModel` enforces it. |
| `lib/posts/research.ts` | `findTrendingTopics(query, hashtags)` — Google News RSS + Google Trends RSS (hand-rolled parser, no dependency) + OpenRouter's web-search plugin, in parallel, clustered into 3-5 topic cards by a cheap model. Each source fails independently to `[]` rather than throwing. |
| `lib/posts/write.ts` | `writePosts(input, status)` — N variants, each its own credit reservation (`ai_post_standard`/`ai_post_premium`/`ai_post_fable`) settled per-variant: a failed model call releases its credit and keeps trying the rest, never charges for nothing. |
| `lib/posts/schedule.ts` | `nextScheduledAt` (pure scheduling arithmetic — see below), `publishScheduledPost`, `sweepPosts`, `scheduleAutopilot`. |
| `lib/linkedin/post.ts` | `postToFeed` extended with `imageUrl`/`imageAlt` — LinkedIn's two-step Images API (`initializeUpload` → `PUT` the bytes), fetched server-side from a Vercel Blob URL. |
| `app/api/posts/upload-image/route.ts` | A customer's own image → Vercel Blob (`@vercel/blob`, `BLOB_READ_WRITE_TOKEN`). JPEG/PNG/WebP, 8MB. |

## Scheduling, without an IANA timezone

`Autopilot.timezoneOffsetMinutes` is a fixed UTC offset (`330` = IST), the
same simplification `lib/org-day.ts` makes for business hours — "when is this
due" becomes arithmetic instead of DST-aware calendar math. `nextScheduledAt`
walks local calendar days forward from a given moment and tests each one
against the schedule (`every_n_days` or `weekdays`), returning the first hit
strictly after that moment. `scheduleAutopilot` subtracts the review lead
time (`reviewLeadHours`, default 3) or ~15 minutes for auto mode, so
`nextRunAt` is when the *job* fires, not the slot itself.

## The sweep (`/api/cron/posts-sweep`, every 5 minutes)

Three independent jobs, each idempotent:

1. **Publish anything `scheduled` and due** — catches a one-off
   `post-publish` job (enqueued via `lib/queue.ts`, QStash in production)
   that got dropped.
2. **Skip a stale `needs_review` draft** — its slot passed with nobody
   approving it. The draft itself is kept; only the window to post it on
   schedule is gone.
3. **Start a due autopilot** — claimed the same way an `Enrollment` is
   (`prisma.autopilot.updateMany({ where: { id, nextRunAt: <value I read> } })`):
   exactly one caller's claim succeeds if two sweeps race on the same row.
   `runAutopilotOnce` finds topics, writes (`draft`s become `needs_review` in
   review mode, or `scheduled` — at the *original* slot time — in auto mode),
   and advances `nextRunAt` to the next occurrence.

## What's unverified

- **The OpenRouter web-search plugin**, called through the same
  Anthropic-compatible endpoint the agent loop uses elsewhere — the plan
  called for checking this first and falling back to OpenRouter's own
  chat-completions endpoint if the plugin isn't honoured there.
  `fromOpenRouterSearch` in `research.ts` already uses the chat-completions
  endpoint directly (simpler, and it's what `write.ts` uses too), so if the
  plugin doesn't return `annotations.url_citation` in that shape, this
  degrades to "no web results" rather than failing loudly — worth confirming
  against a real OpenRouter response before trusting the topic cards.
- **LinkedIn's Images API** (`uploadImage` in `lib/linkedin/post.ts`) — written
  from LinkedIn's documented two-step contract, never called against a real
  connected account.
- **Google Trends' daily RSS** is unofficial and has moved before; if it 404s
  or changes shape, `fromGoogleTrends` returns `[]` and research continues
  with News + web search alone.
- No script exercises `research.ts` or `write.ts` end to end — both make real
  external calls, so `scripts/verify-posts.ts` deliberately stops at the
  scheduling and sweep logic. Confirming the writer needs an `OPENROUTER_API_KEY`
  and a willingness to spend a few real credits on a test call.

## Not done

- Feature-gating `POST_MODELS` per plan (only "premium" checks
  `premium_ai_models`; there's no per-org admin allow-list narrowing which
  *standard* models show, as the original plan mentioned as a maybe).
- The autopilot editor's schedule/query/model fields are **create-only** —
  changing them means deleting and recreating the autopilot (`brief` and
  `enabled` can be edited after creation). Simplified deliberately given time;
  full in-place editing would need re-validating and rescheduling
  `nextRunAt` from the new schedule.
- No `AutopilotRun` history UI beyond what `/api/autopilots/[id]` returns —
  the autopilot editor page doesn't render `runs` yet.
