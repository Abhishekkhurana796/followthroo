# channels.md — Per-Channel Features & Official Limits

**Last updated:** 2026-09-07
**Status:** draft

> Every channel module implements a uniform `send(lead, rendered)` interface and goes
> through `lib/ratelimit` — except LinkedIn, whose `send()` only enqueues, so its cap is
> enforced at claim time instead. Consolidated numbers live in
> [rate-limits.md](rate-limits.md).

---

## Email

**Stack:** Nodemailer (SMTP, no heavy deps) or Gmail API. Optional SendGrid/Mailgun
for high volume.

**Features**
- TLS/STARTTLS, **OAuth2** for Gmail/Exchange, **DKIM signing**, attachments,
  HTML + text bodies.
- Template variables (`{{firstName}}`, `{{companyName}}`, …) with fallbacks.
- Bounce/spam tracking via webhooks or IMAP; suppression on hard bounce.

**Deliverability requirements**
- Authenticate the sending domain: **SPF + DKIM** (Nodemailer supports DKIM),
  ideally DMARC.
- Warm up new domains/accounts; monitor bounce + spam rates (Google throttles on
  poor reputation).

**Limits (Gmail/Workspace)**
- Free/trial: **500 messages/day**. Paid Workspace: **~2,000/day**.
- External recipients capped (e.g. ~3,000/day outside your domain); ≤500 recipients
  per message; rolling 24h window.
- Practical throttle: queue + pause (~40 emails/hour) to avoid blocks. Full strategy
  in [rate-limits.md](rate-limits.md).

### Who a message goes out as (2026-08-11)

**Every message a contact receives leaves through a `SendingAccount` the workspace
connected itself.** There is no platform fallback mailbox, and re-adding one would
reintroduce four problems at once:

- mail left under Followthroo's `MAIL_FROM` rather than the customer's domain, while
  the body was still signed with the rep's name;
- the reply poller only walks `SendingAccount` rows, so replies to that mailbox were
  **never captured** — stop-on-reply never fired, the Inbox stayed empty, and no
  follow-up task was ever created;
- deliverability reputation was shared across every tenant, and the Deliverability
  page (keyed on `sendingAccountId`) could not score it;
- the rate limiter keys on `(org, account)`, so each tenant got a *separate* quota
  against one physical mailbox — N orgs × 40/hour through a single account.

A send with no connected account now fails loudly with a reason the UI shows.

`SMTP_*` / `MAIL_FROM` still exist, for exactly one purpose: `sendSystemEmail()` in
`lib/channels/email.ts`, which is Followthroo mailing **its own users** (new-lead
alerts, SLA escalations). It is a separate function from `emailChannel.send` so the
line can't blur, and nothing it sends is ever addressed to a lead.

**Tenant scoping:** an account id is a bare uuid, so every lookup is
`findFirst({ id, organizationId })` and `orgId` is part of the adapter's `send()`
signature. `/api/campaigns` (POST + PATCH) and `/api/agent` verify the submitted
account belongs to the caller before attaching it. Guarded by
`scripts/verify-sending.ts`.

---

## LinkedIn

**Reality:** LinkedIn is stringent. Automation of a personal account is a gray area
that violates LinkedIn's terms and risks restriction. Use with extreme care.

**Options**
- **Official API** — only **company/organization pages** are cleanly supported
  (`w_organization_social_feed` for admins). Personal-account actions need
  `w_member_social_feed`, granted **only to approved partners**.
- **Browser automation** (Puppeteer/Playwright) to click Connect / send messages as a
  logged-in user. Fragile, TOS-sensitive; preserve session cookies securely, use a
  stable IP.

**Limits & humanization**
- Start at **~20 invites/day** for a new account; ramp gradually with acceptance rate
  (e.g. +5/week). Hidden caps trigger "Try again next week."
- Randomize delays, interleave organic actions (profile visits, likes), stop on
  "out of invites." Never burst. Consider multiple accounts with distinct IPs only if
  compliant with your risk posture.

---

## WhatsApp

**Stack:** Official **WhatsApp Business API** via **Twilio** (Node/Python SDK) or
Meta's API directly.

**Rules**
- Messages outside the **24-hour** customer service window must use **pre-approved
  templates**, and require prior **opt-in**.
- Respect the **quality rating** — throttle or fall back if quality drops to negative.

**Limits (messaging tiers, per business portfolio)**
- New account: **250 unique users / 24h**, shared across all numbers in the portfolio.
- Auto-scales **250 → 2,000 → 10,000 → 100,000** after business verification / sending
  high-quality messages. Twilio default: 250 contacts/day, upgradable via Meta's
  scaling program.
- Track unique recipients in a rolling 24h; queue overflow to the next day.

---

## Social comments

Posting comments/replies on social posts. Prefer official APIs; fall back to careful
browser automation with randomized timing only where TOS allows.

| Platform | API surface | Notes |
|---|---|---|
| LinkedIn | Comments API — **organization posts** only; personal limited (`w_member_social_feed`) | OAuth app; same partner restriction |
| Twitter/X | API v2 tweets/replies | Recent pricing changes; check current tier |
| Facebook | Graph API page comments (user token) | Per-app rate limits |
| Instagram | Business API commenting on **business** posts | OAuth; business account required |

**Rule:** heed each platform's TOS + rate limits; add natural delays; never mass-spam.

---

## Uniform module contract

```ts
// lib/channels/<name>/index.ts
export interface Channel {
  send(lead: Lead, rendered: RenderedMessage): Promise<SendResult>;
  // must acquire quota from lib/ratelimit before sending
  // must write messages + activity_log on completion
}
```

---

## Deliverability & tracking (Phase 2 — 2026-07-05)

- **Open/click tracking** (`lib/tracking.ts`): before each email send, `job-processor`
  pre-generates the `Message` id, rewrites `http(s)` links to `/api/track/click/[messageId]`
  and appends a 1×1 pixel at `/api/track/open/[messageId]`. Both routes are unauthenticated,
  resolve the org from the `Message`, write an `ActivityLog(opened|clicked)` (with `messageId`),
  and — for clicks — 302 to the original URL. Feeds Reports and the campaign `condition`
  nodes (`opened` / `clicked`).
- **Reports** (`/dashboard/reports`, `lib/reports.ts`): funnel, engagement time series,
  per-campaign breakdown, open/click/reply rates (Recharts).
- **Mailbox warm-up** (`lib/warmup.ts`): enabled mailboxes in an org email each other on a
  ramping daily schedule (`/api/warmup/run`, cron every 4h). The reply poller
  (`lib/inbox/poller.ts`) recognizes warm-up mail (sender is one of the org's own mailboxes),
  records `WarmupEvent` placement (inbox/spam) and **rescues spam** via Gmail `messages.modify`.
- **Deliverability** (`/dashboard/deliverability`, `lib/deliverability.ts`): per-mailbox
  score = inbox/received; toggle warm-up + daily target per mailbox.
- **Per-account DKIM**: `SendingAccount.dkim{Domain,Selector,PrivateKey}` now sign per-account
  SMTP sends (previously only the env default transport was signed).
- **Gmail scope**: connecting a Gmail account now requests `gmail.modify` (read + label
  changes) in addition to `gmail.send`. Accounts connected before this must reconnect for
  reply polling + warm-up placement/rescue to work.

---

## LinkedIn — desktop app sends, extension sources (Phase 5 — rewritten 2026-09-07)

LinkedIn does **not** grant connection-invite or DM access through its developer program,
and its User Agreement (§8.2) prohibits bots or automated methods for connections/messages
outright. There is no API path here at any price: `w_member_social`, the scope our OAuth
flow requests, only posts to your own feed. An invitation therefore requires a real browser
holding a real LinkedIn session, and the only open question is whose browser.

**It is the customer's own.** `desktop/` is an Electron app they install on Windows. It
drives Chrome with Playwright, on their machine and their IP, signed into the LinkedIn
account they already use. We never receive a `li_at` cookie, so there is nothing to encrypt,
nothing to rotate, and no datacenter IP for LinkedIn to correlate against a home session.
See `desktop/README.md` for why this beat the cloud-browser-plus-residential-proxy model
that Expandi and HeyReach run.

**Flow:**
1. A campaign `send` node with `channel: "linkedin"` → `lib/channels/linkedin.ts` enqueues a
   `LinkedInAction`. Bulk enqueue from the Leads screen goes through `enqueueManyLinkedIn`.
2. The desktop app polls `GET /api/linkedin/queue?limit=1` (auth: per-member
   `LinkedInAccount.extToken` — the same pairing token the extension uses), claims one
   action, navigates to the profile, and runs `desktop/page-actions.js` in the page: find
   the profile's own Connect, add the note, click Send, and confirm the dialog closed.
3. It `POST`s the terminal outcome, recorded by `completeAction` as a `Message` +
   `ActivityLog` + `ConversationEvent`. Then it waits a randomized `min–maxDelaySec` and
   claims the next.

**One claimer.** The extension (`extension/`, MV3) still does sourcing and no longer asks
for invite actions at all. `claimActions` marks a row `in_progress` with a read followed by
a write, so two clients polling one queue can each hold the same action and each send it —
and an invitation cannot be recalled. Any third client replaces the desktop app rather than
running beside it.

**Deleting a campaign never strands an invitation.** `LinkedInAction.campaignId` has no
foreign key, so the old bare delete left a campaign's queued actions `pending` for the
desktop app to send. `DELETE /api/campaigns/[id]` now cancels `pending|in_progress|drafted`
actions (→ `skipped`) and stops live enrollments in one transaction, and `selectClaimable`
refuses any action whose campaign is gone or archived. A campaign with sent history is
archived (`Campaign.archivedAt`) rather than removed, so attribution survives.

**The sourcing bar (extension 3.1.0).** `extension/content.js` puts a bar and a checkbox per
row above LinkedIn lists — people search, your Connections, a company's people, a group's
members — and only there. On the feed it once counted the profile
links in a post stream as "a list we could not read" and covered the page with that
message. It sits in flow rather than sticky, so it never slides over the first results;
once it scrolls away the floating launcher carries the selection count. Names are read from
every profile link in a card, not just the first, because Connections cards lead with a
photo link that has no text.

**Caps + safety:** the daily invite cap is enforced twice on purpose — server-side in
`claimActions` against `LinkedInAccount.dailyInviteCap`, and client-side in `desktop/runner.js`
against `MAX_PER_DAY`, with the day's tally persisted so pressing Start twice does not send
forty. Stale `in_progress` claims are reclaimed after 15 min. A run also stops early on
LinkedIn's own weekly-limit or verification dialog (first occurrence, marked `fatal`), on
three consecutive failures, on a sign-in wall, and when automatic sending is switched off in
the web app. Config + token live on `/dashboard/linkedin`.

**Note:** `safeSend` in `lib/channels/index.ts` deliberately skips the generic
`lib/ratelimit.ts` day-window for LinkedIn. That limiter is charged before `channel.send()`,
but LinkedIn's `send()` only *enqueues* — so charging it meant a campaign could exhaust
20/day on rows that were merely queued, while bulk enqueue bypassed the limiter entirely and
counted nothing. One cap, at claim time.

**⚠️ ToS:** automated sending from a personal LinkedIn account is against the User
Agreement and the risk is to the customer's account. The web app gates it behind a switch
that says so, per-action, so turning it off stops the very next invitation. Keep caps
conservative (≤ ~20 invites/day), warm up new accounts. The official "Sign in with LinkedIn
(OIDC)" + "Share on LinkedIn" APIs cover identity and posting — see the next section.

---

## LinkedIn — connecting an account, officially (2026-09-04)

**Why this section exists.** Every competitor advertises "connect your LinkedIn account" and
we did not have one, which read as a missing feature. It was two things at once: a real gap
(there was no account connection anywhere in the product, only a bearer token to paste into
an extension) and a question about architecture. Both are answered here.

### What competitors mean by it

Expandi, Dripify, HeyReach, Waalaxy (cloud mode) and PhantomBuster ask for the member's
`li_at` session cookie — sometimes directly, sometimes through a "connector" extension whose
only job is to read the cookie and ship it to the vendor. The vendor stores that session and
drives LinkedIn as the member from its own cloud, usually behind a dedicated residential
proxy per account so the traffic looks like it comes from one person.

That is what makes unattended, laptop-off automation possible, and it is also its own
failure mode: a live session used from an IP the member has never signed in from is the
clearest signal LinkedIn's enforcement has. Restrictions in this category are routine, and
a breach of any one vendor exposes every customer's LinkedIn account simultaneously.

### What we built instead

`lib/linkedin/oauth.ts` — LinkedIn's own 3-legged OAuth. The member clicks **Connect
LinkedIn account** in Settings → LinkedIn, consents on linkedin.com, and returns with their
verified name, photo and email on their `LinkedInAccount` row.

| | Endpoint |
|---|---|
| Authorize | `https://www.linkedin.com/oauth/v2/authorization` |
| Token | `https://www.linkedin.com/oauth/v2/accessToken` |
| Identity | `https://api.linkedin.com/v2/userinfo` |
| Post | `https://api.linkedin.com/rest/posts` (`LinkedIn-Version` header required) |

**Scopes:** `openid profile email` (Sign In with LinkedIn) + `w_member_social` (Share on
LinkedIn). Overridable via `LINKEDIN_SCOPES`, because scope availability is per-app — asking
for a scope the app has not been granted fails the whole consent with "Invalid scope"
rather than degrading gracefully.

**Redirect URI** must be registered verbatim in the Developer Portal:
`https://app.followthroo.com/api/linkedin/oauth/callback`. LinkedIn strips query parameters
from it, so the member and org travel in httpOnly cookies (`li_oauth_state` / `_org` /
`_user`), state-checked in the callback.

**Token lifetime is 60 days with no refresh.** Programmatic refresh tokens are gated behind
LinkedIn's partner programme, so an ordinary app cannot renew silently. `connectionState()`
returns `expiring` from 7 days out and the settings page prompts a reconnect, rather than
letting the member discover it through a post that did not go out.

**Storage:** `liAccessToken` / `liRefreshToken` are in `ENCRYPTED_COLUMNS`
(`lib/db-encryption.ts`), so they are AES-256-GCM ciphertext at rest like every other tenant
credential. Neither ever reaches a browser — `GET /api/linkedin/connect` returns a name, a
photo URL and an expiry date. Disconnecting nulls the columns outright rather than setting a
flag.

### What the connection does and does not unlock

| Capability | Official API | How we do it |
|---|---|---|
| Verified identity | ✅ `openid profile email` | OAuth, this section |
| Post to own feed | ✅ `w_member_social` | `lib/linkedin/post.ts`, server-side, no browser |
| Read search results | ❌ not sold at any tier | Extension, member's own tab |
| Company employees, post likers, group members, event guests | ❌ | Extension |
| Send connection invitations | ❌ | Extension drafts, human sends |
| Send messages | ❌ | Extension drafts, human sends |

Sales Navigator and Marketing Developer Platform APIs are partner-gated and closed to
general applicants; they do not change this table for a self-serve SaaS.

**So both halves are load-bearing.** The account connection is the member's identity and
their posting rights, and it is genuinely official. The extension is how sourcing and
drafting happen, in the member's own session where the activity is indistinguishable from
what it is — a person using LinkedIn. Neither replaces the other, and the settings page says
so in a disclosure on the page rather than leaving people to wonder.

**Verification:** `npx tsx --env-file=.env.local scripts/verify-linkedin-oauth.ts` — 21
checks covering the encryption registration and AAD binding, authorize-URL construction, and
the expiry state machine. No database required.
