# Followthroo for LinkedIn — Chrome extension

Reads LinkedIn pages you ask for, in your own logged-in tab, and drafts your
outreach for you to send. It never sends anything on its own.

---

## Why it works this way

Every comparable tool asks for your **LinkedIn session cookie** and then browses
as you from their servers. That is the model behind all 35 automations in
[`../docs/phantombuster.md`](../docs/phantombuster.md), and it has two problems:
LinkedIn's enforcement targets exactly that pattern, and one breach of the
vendor's database exposes every customer's LinkedIn account at once.

This extension holds no credential. It *is* your session — it runs in your
browser, on pages you are already allowed to see. There is nothing to hand over
and nothing for us to lose.

The second rule follows from the first: **we automate everything up to the click,
never the click itself.** For an invite or a message, the extension opens the
page and fills the box, then stops. You read it and press send. LinkedIn's User
Agreement (§8.2) prohibits automated connecting and messaging; a real person
pressing send is the distinction that keeps accounts alive.

## What it does

**Reads** — search results, profiles, companies, company employees, post likers
and commenters, group members, event guests, your connections, recent activity.
Rows come back to Followthroo for review before anything becomes a contact.

**Drafts** — queued invites and messages. Fills the box, opens the tab, waits for
you.

Daily ceilings are enforced by the server, not just here: ~20 invites, ~80
messages, ~80 profile loads. They exist to keep your account healthy.

---

## Install (development)

1. In Followthroo: **Settings → LinkedIn**, copy your connection token.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select this `extension/` folder.
3. Click the extension icon → **Settings** → paste your **App URL**
   (`https://app.followthroo.com`) and **token** → **Connect** → **Start**.
4. Stay logged into LinkedIn in the same browser.

Pointing at `http://localhost:3000` for local development will prompt for an
extra permission — localhost is an `optional_host_permission`, because a
published extension that can reach your own machine is something the Web Store
rightly questions. Press **Allow** when Chrome asks.

---

## Publishing to the Chrome Web Store

Everything below is what the review process actually asks for.

**Package** — zip the *contents* of this folder (not the folder itself):

```
manifest.json  background.js  scrapers.js
popup.html  popup.js  options.html  options.js
icons/icon16.png  icons/icon32.png  icons/icon48.png  icons/icon128.png
```

Do not include `README.md` or any `.zip`.

**Listing fields**

| Field | Value |
|---|---|
| Name | Followthroo for LinkedIn |
| Category | Workflow & Planning |
| Privacy policy URL | `https://followthroo.com/extension-privacy` |
| Homepage | `https://followthroo.com` |
| Single purpose | Save people from LinkedIn into the user's Followthroo CRM, and draft outreach for the user to send themselves. |

**Permission justifications** — reviewers ask for one per permission, and vague
answers get rejected:

- **`storage`** — remembers the user's Followthroo address, connection token and
  pacing preferences on their own machine.
- **`alarms`** — paces work at human intervals instead of bursts, which is what
  keeps the user's LinkedIn account within safe rates.
- **`scripting`** — reads the contents of the LinkedIn page the user asked to
  import from, and fills the message box on drafts.
- **`host_permissions: linkedin.com`** — the pages being read are on LinkedIn.
- **`host_permissions: app.followthroo.com`** — where jobs are fetched from and
  results returned.

We deliberately do **not** request the `tabs` permission. Opening and closing a
tab needs no permission; `tabs` would additionally expose the URLs of every tab
the user has open, which this has no business seeing.

**Remote code** — none. All scripts ship in the package; nothing is fetched and
evaluated at runtime. Say so on the form, because it is asked directly.

**Data disclosure** — declare: *Personally identifiable information* (names and
profile links read from pages the user requests) and *Website content*. Tick that
it is **not sold**, **not used for anything unrelated to the single purpose**, and
**not used for creditworthiness or lending**.

**Before you submit**

- [ ] Bump `version` in `manifest.json` — the Store rejects a re-upload at the same version
- [ ] `https://followthroo.com/extension-privacy` is live and reachable
- [ ] Screenshots: 1280×800 or 640×400, showing the popup and a real import
- [ ] Test the packaged zip via Load unpacked before uploading

Expect the first review to take a few days. Extensions that read page content are
reviewed by a human, and the "single purpose" answer is what they weigh hardest.

---

## Maintenance

LinkedIn changes its markup often, and `scrapers.js` is where that hurts. Each
reader distinguishes **"the page had nothing on it"** from **"we could not find
the container we expected"**, and only the second is reported as a failure — so a
breakage surfaces as *"LinkedIn changed its layout"* in the app instead of
quietly looking like an empty search. When that appears, the selector lists in
`scrapers.js` are what need updating; nothing else does.
