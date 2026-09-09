# LinkedIn sourcing — UX

**Last updated:** 2026-09-03
**Status:** draft

The design behind bringing contacts *in* from LinkedIn. Reference spec for what
each scraper yields is [phantombuster.md](phantombuster.md); this is how it is
presented to a person.

---

## The problem with the obvious design

The obvious design is a new **LinkedIn** row in the sidebar opening a grid of
thirteen scrapers — Search Export, Profile Scraper, Company Employees Export,
Group Members Export, and so on. That is PhantomBuster's own information
architecture, and copying it would be a mistake twice over.

It breaks the standing rule in CLAUDE.md that the rail is not an index of the
codebase — it went from 18 rows to 11 for a reason. And it puts thirteen choices
in front of someone before they can do anything, when Hick's law says every
option added is time added to the decision.

More importantly it is the wrong mental model. Nobody thinks *"I would like to
run the Company Employees Export phantom."* They think **"I want the people on
this page"** — and they already have the page open in another tab.

## The design: the URL is the input

One field. Paste a LinkedIn URL, and the shape of the URL tells us which scraper
to run:

| What you paste | What we run | What you get |
|---|---|---|
| `/search/results/people/…` | search export | People from that search, up to 1,000 |
| `/in/{slug}` | profile scrape | One full profile |
| `/company/{slug}` | company scrape | Company details |
| `/company/{slug}/people/` | company employees | Everyone who works there |
| `/posts/…` · `/feed/update/…` | post engagers | Everyone who liked or commented |
| `/groups/{id}/members/` | group members | The member list |
| `/events/{slug}/` | event guests | Registered attendees |
| `/mynetwork/invite-connect/connections/` | connections export | Your 1st-degree network |
| `/{slug}/recent-activity/` | activity extract | Their recent posts and engagement |

Thirteen capabilities, **zero choices to make**. The user's own description of
what they wanted was "provide the search query and the search url" — the URL was
always the input; the scraper type is something we can derive rather than ask.

Recognition over recall: we echo back what we detected in plain words ("People
from this search — up to 1,000") so the person confirms rather than remembers.
An unrecognised URL says which kinds are supported, rather than failing blankly.

## Where it lives

**Inside the existing Add Lead dialog on the Leads screen.** That dialog already
has three tabs — *Add manually*, *Import CSV*, and a disabled **Find leads**
marked "coming soon". This is that tab. No new sidebar row, no new screen: the
surface was already designed and labelled, it just had nothing behind it.

Running jobs and their results live at `/dashboard/leads?view=sourcing`, reusing
the view-parameter pattern established by `?view=unassigned`. A scrape of a
thousand rows needs a full-width table, and it is still the Leads screen, because
that is what the result is — leads.

## The flow

```
Leads → Add Lead → Find leads
   │
   ├─ extension not connected? ──→ "Connect the extension first" + one link.
   │                                Checked FIRST: nothing below works without it.
   │
   ├─ paste URL ──→ detect kind ──→ unrecognised? show what is supported
   │                    │
   │                    ▼
   │            "People from this search — up to 1,000"     ← recognition, not recall
   │            [ How many? 100 ▾ ]                          ← smart default, not a blank
   │                    │
   │                    ▼
   │            daily cap reached? ──→ "80 of 80 profiles today. Resets 9am."
   │                    │
   │                  [ Start ]                              ← the one primary action
   │                    │
   ▼                    ▼
sourcing view ←── job runs in the rep's own tab, rows stream in
   │
   ├─ 0 rows, selector miss  ──→ "LinkedIn changed this page. We are on it."
   ├─ 0 rows, empty result   ──→ "That search has no results."
   │
   ▼
review table ──→ rows, with duplicates already flagged
   │              [ Analyse with AI ]  ← optional, on a chosen subset
   │
   ▼
[ Import 47 contacts ] ← the one primary action here
   │
   ▼
contacts, auto-assigned by the linkedin_search source rule (lib/assignment.ts)
```

Nothing imports silently. A bad search URL should not put two thousand wrong
contacts in the database and make somebody delete them one at a time.

## Hierarchy and states

**One primary action per step**, per the rule that if two things shout neither is
heard: `Start` in the dialog, `Import N contacts` in the review. Everything else
— row selection, AI analysis, cancelling a job — is secondary weight.

The states that must exist, because they are the ones that actually happen:

- **Extension not connected.** Checked before anything else renders. This is the
  single most likely reason the feature does nothing, so it cannot be a
  footnote.
- **Cap reached.** Says the number and when it resets, not just "limit exceeded".
  Ceilings come from [phantombuster.md](phantombuster.md) — 80 profiles/day,
  1,000 results per search, 100–200 post engagements per run.
- **Selector miss vs empty result.** LinkedIn changes its markup often. "We could
  not read this page" and "this page has nothing on it" are different problems
  and must read differently, or every breakage looks like an empty search.
- **Running.** Progress by row count, and the job survives navigating away.
- **Duplicates.** Flagged in the review table before import, not silently merged
  after — the identity graph will dedupe, but the person should see it happening.

## Type, colour, spacing

Nothing new. This uses the existing system: `font-display` for headings, the
`ink` / `ink-soft` / `ink-faint` text ramp, `tint` for grouping, `line` for
edges, `danger` for caps and failures, `success` for completed jobs. Spacing on
the established 4/8 scale via the existing `Panel` and `DashHeader` primitives.

A new feature should look like it was always there. Introducing a second visual
language for LinkedIn sourcing would be the most visible possible way of saying
this was bolted on.

## What the official LinkedIn API can and cannot do here

`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` are for LinkedIn's **official**
OAuth API, and are worth being precise about, because they do not overlap with
this feature as much as they appear to.

They enable, with a standard developer app:

- **Sign In with LinkedIn** (OpenID Connect) — a third sign-in button beside
  Google and Zoho.
- **Share on LinkedIn** (`w_member_social`) — posting to the member's own feed.
  This is the one item in the whole PhantomBuster catalogue (#24 Auto Poster)
  with a fully official, ToS-clean API path. No extension, no risk.

They do **not** enable search, profile data, connections, messaging or connection
requests. Those live in the Sales Navigator and Marketing APIs, which are
partner-gated and, as of 2026, closed to new applicants. So the credentials
complement this feature; they do not replace the extension.
