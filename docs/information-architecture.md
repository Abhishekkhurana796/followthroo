# information-architecture.md — Product IA & the core screens

**Last updated:** 2026-08-11
**Status:** stable — V3 Phase 1 shipped

> How the product is organised and why. If you are adding a screen, start here:
> the default answer to "where does this go?" is **inside something that already
> exists**, not a new row in the sidebar.

---

## The premise

Followthroo is a **one-stop CRM**, not a CRM with an outreach tool bolted on. A
salesperson does not think in modules. They think:

> Who do I need to contact? · Who am I talking to? · Who needs following up? ·
> What's open? · What happened today?

The IA mirrors that sentence. Everything else is one level in.

Two rules the product is built on:

1. **The user should never need to understand the integration.** A lead from
   IndiaMART, Meta Lead Ads, a CSV or a webhook is just a lead with a source label.
   Channel and adapter details never surface as separate destinations.
2. **Every interaction, whatever the channel, is a first-class event on the same
   timeline.** See the unified timeline in
   [crm-data-model.md](crm-data-model.md).

## Navigation

Single source of truth: `components/dashboard/nav-items.ts`. The desktop rail and the
mobile drawer both read it, so they cannot drift.

```text
              Home         /dashboard
SALES         Leads        /dashboard/leads
              Pipeline     /dashboard/pipeline
COMMUNICATE   Inbox        /dashboard/inbox
              Tasks        /dashboard/tasks
AUTOMATE      Campaigns    /dashboard/campaigns
              LinkedIn     /dashboard/linkedin
              Templates    /dashboard/templates
ANALYZE       Reports      /dashboard/reports
              Settings     /dashboard/settings
```

Ten rows, as of 2026-09-05. This replaced an 18-row, five-group rail, and then
lost three more — Companies (a way of looking at leads, reached from Leads), Test
emails (a model-testing harness, reached from Templates) and Calendar (a `soon`
stub that could not be clicked). LinkedIn gained one, for sourcing only; see the
narrowed exception in CLAUDE.md.

Nothing was deleted — the rail simply stopped being an index of the codebase:

| Was a top-level row | Now lives |
|---|---|
| Deliverability · Ageing · Escalations · Control tower | Reports, via `components/dashboard/AnalyzeNav.tsx` |
| Sending accounts | Settings (`SettingsNav`) |
| People database · Signal agents · Calls · Meetings | removed as stubs; Calendar keeps the one "soon" slot |

`AnalyzeNav` is a per-page component rather than a route-group layout, because those
five pages are siblings in the route tree, not children of `/dashboard/reports`. It
keeps the trail visible without inventing a hierarchy that doesn't exist.

**Terminology:** the rail says **Leads**, so does the page. "Contacts" is gone —
one word for one thing. `Campaigns` keeps its name and route this phase; renaming it
to Sequences belongs with the sequence-builder work.

## The screens

### Home — `/dashboard`

A **work queue, not a scoreboard**. The old overview showed four lifetime counters,
which answer "how are we doing" — a question nobody opens a CRM at 9am to ask.

- Greeting + "N things need your attention"
- Four counters (new leads · follow-ups due · new replies · overdue in pipeline) that
  are themselves links into the work they count
- **Needs your attention** — every contact whose last word was theirs
- Follow-ups due, today's leads by source, pipeline snapshot
- The activation checklist stays, below the fold

Analytics live on Reports. Nothing on Home is there to be admired.

> **Attention follows the conversation, not the funnel.** `getUnanswered()` in
> `lib/queries.ts` walks the conversation timeline, *not* open pipeline items — a lead
> who replied but was never added to a pipeline is precisely the one most likely to
> fall through, and reusing the control-tower query would have hidden them behind a
> cheerful "every conversation has been answered." Control tower keeps its
> pipeline-scoped query; it answers a manager's question, not a rep's.

### Leads — `/dashboard/leads`

One table, full width. Columns: Lead · Company · Source · Stage · Owner · Last
activity · **Next action**. That last column is the product; it is styled loudest on
purpose and links straight into the record.

`+ Add Lead` opens a dialog offering *Add manually · Import CSV · Find leads (soon)*
over a short form — an email **or** a LinkedIn URL is the only requirement. Groups
(static lists, same thing as tags) moved into a dialog so they stop competing with the
table for space.

### Lead detail — `/dashboard/leads/[id]`

The most important screen in the product. Three columns under a header and a
next-action band:

| Column | Holds |
|---|---|
| Profile | identifiers (inline-editable — the LinkedIn URL is what the Chrome extension acts on), "also known as" from the identity graph, qualification signals that drive the score |
| Timeline | the merged feed, newest first, with a note composer (⌘/Ctrl+Enter saves) |
| CRM rail | stage (moving it writes a `StageTransition`; backward needs a reason), pipeline, owner, value, SLA, open tasks, live sequences |

Channel buttons — Email · WhatsApp · LinkedIn · Call — are enabled per identifier and
**disabled with the reason** when one is missing, never hidden. "You can't WhatsApp
them because there's no number" is useful; an absent button is not.

### Tasks — `/dashboard/tasks`

Overdue / Today / Upcoming / Recently done. Rows carry the lead, the channel, the due
time, the owner (in the Everyone view), a priority dot, and an `auto` marker when the
system created it. Not a project manager — the only job is that nothing falls through.

"Nothing falls through" is what justifies the 2026-08-24 additions and bounds them.
A task can be given to a teammate (owner/admin anywhere, group leader within their
department, member self-only), carries a real due date, and now actually reaches
someone: the owner is emailed when it comes due, their manager if it is still open a
day later, and everyone gets one morning digest at 8am **local** time. Priority and
instruction exist because a task handed to someone else needs to say how urgent it is
and what "done" means.

Still deliberately absent: subtasks, dependencies, projects, recurring tasks.

### Inbox, Pipeline, Control tower

Each now links into the lead record: Inbox gets an "Open lead" link on the thread
header, pipeline card titles are links (the title only — a full-card anchor swallows
the drag), and control-tower rows point at the contact rather than the list.

## Adding a screen

Before adding a nav row, answer: *which of the five sentences above does this serve?*
If it doesn't serve one, it belongs inside an existing screen — as a tab, a dialog, a
sub-nav entry, or a panel on the lead record. The rail is the product's table of
contents, and eleven rows is already generous.

## Product tour

`components/dashboard/tour/steps.ts`, seven steps in the order the work happens:
what needs you → your leads → bring the list in → sequence the follow-up → build from
a preset → replies land here → nothing falls through. Targets are `data-tour`
attributes (`tour/target.ts`); `e2e/tour.spec.ts` walks the same list, so the tour and
its test cannot disagree. Changing a step's title means changing the spec.
