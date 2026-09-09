# Chrome Web Store listing — copy/paste

Everything below goes straight into the developer console. Screenshots are in
`../store-assets/`. Packaging and permission justifications are in `README.md`.

---

## Name

```
Followthroo for LinkedIn
```

## Short description (132 char limit — this is 121)

```
Save people from LinkedIn into your Followthroo CRM, and draft your outreach. You review and send every message yourself.
```

## Category

`Workflow & Planning`

## Language

English (United Kingdom)

---

## Detailed description

```
Add people to your CRM from the LinkedIn page you're already looking at.

Followthroo for LinkedIn puts a checkbox next to everyone in a search. Tick who you want — or take every result across every page — and they land in your Followthroo pipeline, deduplicated against contacts you already have and assigned to the right person on your team.


WHAT IT BRINGS IN

• People from a LinkedIn or Sales Navigator search
• Everyone who works at a company
• People who liked or commented on a post — usually the warmest list, because they raised their hand in public
• Members of a group you've joined
• People registered for an event
• Your own connections
• A single profile, in full

You never pick a tool or a mode. Whatever page you're on, the extension reads that page.


IT DRAFTS. YOU PRESS SEND.

For connection requests and messages, the extension opens the page and fills in the text, then stops. You read it, edit it if you want, and send it yourself.

This is deliberate. Automated connecting and messaging is against LinkedIn's User Agreement, and a real person clicking send is the distinction that keeps accounts in good standing. We won't automate that click, and we'd be suspicious of anything that offers to.


WE NEVER HOLD YOUR LINKEDIN LOGIN

Most tools in this category ask for your LinkedIn session cookie and then browse as you from their own servers. That means a single breach of theirs exposes every customer's LinkedIn account at once.

This extension works differently. It runs inside your own logged-in tab, so there is no credential to hand over and none for us to store. No password. No session. Nothing of yours on our servers.

It reads only what's already visible on the page in front of you — the same names, headlines and employers you can see yourself — and only when you ask it to.


LIMITS ARE THE FEATURE

Around 20 connection requests and 80 messages a day, paced at human intervals rather than in bursts. Ceilings are enforced by our servers, not just by the extension, because your account's health is worth more than a bigger number.

And when LinkedIn changes its layout, we say so — instead of quietly returning nothing and letting you think the search found nobody.


WHAT YOU NEED

A Followthroo account (free to start) and a LinkedIn account you're signed in to in the same browser. Connect the two once with a token from Followthroo → Settings → LinkedIn, and you're done.


PERMISSIONS, PLAINLY

• linkedin.com — to read the pages you ask about, and fill the message box on drafts
• app.followthroo.com — to fetch your queued work and return results
• storage — to remember your settings on your own machine
• alarms — to pace work at safe intervals
• activeTab — to know which LinkedIn page you're on when you click the icon

We deliberately do not request access to your browser tabs or your browsing history.

Full detail: https://followthroo.com/extension-privacy
```

---

## Privacy practices tab

**Single purpose**

```
Save people from LinkedIn into the user's Followthroo CRM, and draft outreach for the user to review and send themselves.
```

**Permission justifications** — see `README.md`, which has one per permission in
the wording reviewers expect.

**Data collected** — tick:

- *Personally identifiable information* — names and public profile links read
  from pages the user explicitly asks to import.
- *Website content* — the visible contents of those LinkedIn pages.

**Certify all three:**

- Not sold to third parties
- Used only for the single purpose above
- Not used for creditworthiness or lending

**Remote code** — answer **No**. Every script ships in the package; nothing is
fetched and evaluated at runtime.

**Privacy policy URL**

```
https://followthroo.com/extension-privacy
```

---

## Screenshots

Four are generated and ready in `../store-assets/` — 1280×800, 24-bit PNG, no
alpha channel:

| File | Shows |
|---|---|
| `1-in-linkedin.png` | What it does, and where |
| `2-popup.png` | The real extension popup |
| `3-you-send.png` | The you-press-send guarantee |
| `4-limits.png` | Rate limits and failure honesty |

Regenerate with `npx tsx scripts/extension-screenshots.ts`.

**The fifth slot is deliberately empty, and it is the one worth filling.**

The most persuasive screenshot is the bar sitting on a real LinkedIn search with
real results, and that cannot be produced without a logged-in LinkedIn session.
It should not be faked: inventing profiles would misrepresent the product, and
depicting LinkedIn's interface with made-up people is not a fight worth having
during review.

To capture it:

1. Load the extension unpacked and connect it.
2. Open a LinkedIn people search that returns plenty of results.
3. Tick three or four people so the bar reads *"4 selected"* and the button
   reads *"Add 4 to Followthroo"*.
4. Screenshot at exactly **1280×800**.
5. Save as PNG, then flatten it — most screenshot tools write an alpha channel,
   and an alpha channel is a silent rejection:

```
npx tsx -e "import('sharp').then(s=>s.default('shot.png').flatten({background:'#ffffff'}).removeAlpha().toFile('store-assets/5-real.png'))"
```

Use your own LinkedIn account for it, not a customer's.
