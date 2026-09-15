# Followthroo for LinkedIn — desktop app

Sends queued LinkedIn invitations and looks up eligible profiles' Contact info
from the customer's own computer, own IP, and logged-in LinkedIn session.

**Last updated:** 2026-09-15
**Status:** active — desktop 1.15.2

## 1.15.2 lookup reliability changes

- Current LinkedIn profile headers can show a bare **1st** beside pronouns
  (for example, `She/Her  1st`) rather than the historical badge class. The
  deterministic reader now treats that text inside the owner's profile card as
  positive 1st-degree evidence; a badge on a recommendation remains ignored.
- Profile enrichment now drives the profile, Contact info link, and fallback
  route in the same persistent Playwright Chrome session used for invitations.
- **Activity** logs every lookup decision in the desktop window and local
  `enrich-run-*.jsonl` file: profile opened, exact degree evidence, Contact
  info route, extraction result, and whether the result reached Followthroo.

## 1.15.1 reliability changes

- Invitation usage, the 20/day account ceiling, remaining capacity, and note
  allowance now come from the server. The desktop never treats its local
  counters as authority.
- Profile enrichment is independently plan-gated by the API (Grow and Scale)
  and shows an upgrade state rather than claiming a lookup on a lower plan.
- Contact-info eligibility reports a concrete connection degree and evidence;
  current profile badges, accessible labels, and Remove Connection are all
  recognized before the deterministic and guarded AI paths proceed.

---

## Why this exists rather than a server

LinkedIn's official API has no endpoint for sending a connection invitation or a
message to a non-connection. `w_member_social` — the scope the OAuth flow in
`app/api/linkedin/oauth/` asks for — only permits posting to your own feed. So
an invitation has to come from a real browser with a real LinkedIn session, and
the only question is whose browser.

Doing it from our servers would mean holding each customer's `li_at` session
cookie and driving it from a datacenter IP. LinkedIn correlates session against
IP, and a session that jumps from a home connection in Mumbai to a Vercel region
gets a checkpoint within hours. Products that do this (Expandi, HeyReach) pay for
a sticky residential proxy per customer precisely to avoid that, and they still
carry checkpoint recovery as their main support cost.

Running on the customer's own machine removes that entire class of problem: their
IP never changes, their session is the one they already use, and no LinkedIn
credential is ever stored by us. The cost is that the machine has to be on, and
that Windows is the only target today.

## How it fits the rest of the product

Nothing on the server was built for this. The app is a client of the same API the
Chrome extension already used:

| | |
|---|---|
| Auth | `Bearer <extToken>` — the pairing token on `LinkedInAccount`, shown under LinkedIn → Browser helper |
| Claim work | `GET /api/linkedin/queue?limit=1` |
| Report outcome | `POST /api/linkedin/queue` with `{ actionId, status, result, code }`. `code: NOTE_LIMIT_REACHED` is the one the server acts on: LinkedIn showed its Premium upsell where the note box should be, so the invitation goes back to the queue with its note and no more notes are handed out that day. |
| Who is next | `GET /api/linkedin/queue?peek=1` — `people` (goes out, in order), `held` (waiting on a pick or on tomorrow's notes) and `notes` (today's allowance). Claims nothing. |
| Who is next for enrichment | `GET /api/linkedin/enrich/peek` — independent read of queued contact lookups and the lookup cap. Claims nothing. |
| Claim contact lookup | `GET /api/linkedin/enrich/claim?limit=1` — used only by the Profile enrichment lane. |
| Note on or off, or reworded | `PATCH /api/linkedin/invitations/:id` with `{ noteChoice?, note? }` from the Up next list. Refused once the invitation is in a browser. |
| Whether an invitation carries its note | Decided on the server: the choice made for the person and today's allowance (`noteAllowance` in `lib/linkedin/queue.ts`). An invitation marked "no" is handed out with `note: null`. |
| Accepted invitations | `POST /api/linkedin/connections/seen` with `{ profileUrls }` — your connections list, read at the start of a run at most every six hours (`readRecentConnections` in `page-actions.js`, rationed by `connectionsCheckDue` in `store.js`). Never in a test run. LinkedIn announces acceptances nowhere else. |
| Daily cap, campaign selection, pacing | `claimActions` in `lib/linkedin/queue.ts` |
| CRM side effects | `completeAction` in `lib/linkedin/queue.ts` |

The extension is still installed and still does **lead sourcing**. It no longer
claims invite actions at all — see the comment in `extension/background.js`'s
`pollOnce`. That is not a preference: `claimActions` marks a row `in_progress`
with a read followed by a write, so two clients polling the same queue can each
come away holding the same action and each send it. A duplicate invitation cannot
be recalled.

## Files

| File | What it does |
|---|---|
| `main.js` | Electron main process. Owns the window, the mutually exclusive lane lock, and the day's tally. |
| `preload.js` | The only bridge to the renderer. `contextIsolation` on, `nodeIntegration` off. |
| `renderer/` | The full-page Automation workspace: two queues, two buttons, progress, settings, and activity. |
| `runner.js` | Invitation lane only: claim → navigate → act → report, with invitation stop conditions. |
| `page-actions.js` | What happens on the LinkedIn page. Shared with the verification scripts. |
| `enrich-flow.js` | Profile-enrichment lane only: claim → navigate → read → report, with independent stop conditions. |
| `api-client.js` | Credential-safe HTTP diagnostics and the retry policy shared by both lanes. |
| `store.js` | Settings and today's count, as JSON in the OS app-data folder. |
| `navigation.js` | Which URLs the web view may load, and which are a Google/Zoho sign-in that has to go through the browser. Plain Node, so it can be checked without Electron. |

`page-actions.js` is the one to be careful with. It runs inside the page, so it
must stay self-contained — no imports, no closure over module scope — because
Playwright serializes it by source. It used to live in `extension/background.js`
and be extracted by brace-matching; it is now a module three callers share, so a
selector fix lands once and the tests exercise the code that ships.

## What is in the window

One app window with two switchable full-page views. **Automation** is local HTML
and is the only place `ft.*` exists. It opens by default and gives invitation
sending and profile enrichment their own queue, progress, stop state, and Start
button. **Web app** is the real hosted Followthroo dashboard in a
`WebContentsView`. The Web app button, Hide this panel, and the 44px trusted rail
switch between them without reloading either view.

That separation is a security boundary, not a layout choice. The Automation view's preload can
launch browser automation against the user's LinkedIn; attaching it to remote
content would hand that reach to anything the page loads. **The web view gets no
preload at all.** If you ever find yourself adding one, stop.

### Signing in

Signing in never finishes inside the app: Google checks the user agent and
refuses embedded browsers. The panel's **Sign in** button opens
`/sign-in?redirect=/desktop-auth` in the system browser; `/desktop-auth` turns
that browser's session into a one-time code and hands it back over
`followthroo://`, and `completeSignIn` in `main.js` adopts it.

The web view's own Google and Zoho buttons take the same route. Before 1.13.0
they did not: the view sent the provider's URL itself to the browser, which
signed the *browser* in — its state cookie lived in the app, and it returned to
`/dashboard`, not `/desktop-auth` — and left the app signed out. `navigation.js`
now recognises a provider sign-in and starts the handoff instead of opening the
URL. The view's user agent ends in `FollowthrooDesktop/<version>`, and the
sign-in page (`components/auth/SocialSignIn.tsx`) uses that — or Electron's
default user agent, for older installs — to show one "in your browser" button
in place of buttons that cannot work there. Email and password still sign in
inside the app.

A third window appears during a run: the Chrome that Playwright drives. That one
is the one to leave alone, and a red bar across the top of every page it visits
says so.

## You can keep using the computer

Every interaction is a DOM `.click()` dispatched inside `page.evaluate` —
synthesized events, not OS input. They need neither window focus nor a visible
window, so the mouse and keyboard stay the user's.

Three things make that true rather than merely claimed, and all three are load-
bearing:

- `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`
  in `openBrowser`. All pacing is `setTimeout` *inside the page*, and Chrome
  throttles covered windows to roughly one timer a minute — so without these,
  putting a window on top turns a 2s wait into 60s and the run appears to hang.
- `document.execCommand("insertText")` is the one focus-dependent call, on the
  message path. It returns false rather than throwing when the document lacks
  focus, so there is a fallback that writes the text directly.
- No `--start-maximized`. Opening over whatever they are doing contradicts the
  point.

Say "leave this window alone", never "don't use your computer". A warning people
learn to ignore is worse than no warning.

The banner is `pointer-events: none` and carries `data-followthroo-overlay`, which
`page-actions.js` explicitly excludes from its button search — otherwise a banner
containing the word "Connect" would be clicked instead of LinkedIn's own button on
every single invitation. There is a test for exactly that.

## Which "Connect" belongs to this profile

A profile page carries several controls reading exactly `Connect`: the person's
own, a duplicate in the bar that sticks to the top as you scroll, and one per
stranger in "People you may know", "Explore Premium profiles" and "Others named
<the same name>". Only the first may ever be clicked, and an invitation cannot be
recalled, so `act()` in `pilot-page.js` refuses to click any of them until one has
been positively attributed to this profile.

Attribution used to be structural: climb from the `<h1>` to the nearest
`<section>`, or up to eight parents looking for a real `button`. Both assumptions
are false on the live site — the top card is a `<div data-view-name>`, the heading
sits ten levels below the card root, and Connect is a bare `<span>` with no role
at all. So the marker was false for every element of every run, nothing could be
attributed, and the app spent four releases reporting that it could see Connect
and was refusing to press it.

Attribution has three signals, ranked. `observe()` exposes two markers:
`ownStrong` (the first two) and `inTopCard` (all three):

- **the card** — climb from the `<h1>` with no depth limit, testing against the
  candidate list that already includes unlabelled spans, stopping before `<main>`
  (`<main>` also holds "More profiles for you"); *strong*.
- **the heading** each control sits under, compared against the profile owner's
  name — the one that survives LinkedIn re-nesting things; *strong*.
- **geometry** — the action row sits just under the name, in the same column;
  *weak*, because a short window puts the sticky top bar right under the name too.

Sections that recommend other people are excluded from all three, which is what
stops "Others named <owner>" — whose heading *is* the owner's name — from
qualifying. The exclusion also runs after resolution, so it covers a decision
given as screen coordinates.

## The deterministic driver

Choosing what to click is not a judgement call once attribution exists, so it is
not made as one. `connect-flow.js`'s `sendConnectionRequest` drives the whole
invite — find the profile's own Connect (by `ownStrong`, **not** the weaker
`inTopCard`, so the sticky bar can never be mistaken for the action row), open it,
add the note, Send, and confirm — clicking each control **by index through
`act()`**, which still refuses the sidebar, a stranger, a destructive label,
Follow-for-an-invite, and any Send during a test run.

Dialog buttons are resolved by index from the observed list, never by their
words: LinkedIn's invite modal is a `<div>` whose text *contains* "Send without a
note" and "Add a note", so a text search lands on the container and clicks a dead
element. The element list carries each button with its own label, which the word
does not.

The model (`pilot.js`) stays as the fallback for a layout the driver does not
recognise — but only *before* any click, so a hand-off can never become a second
invitation. Messages still go through the model. Every outcome carries a
machine-readable `code` (`outcome-codes.js`) alongside the human `result`:
`CONNECT_BUTTON_NOT_FOUND`, `CONNECT_BUTTON_AMBIGUOUS`,
`INVITATION_SUBMISSION_UNCONFIRMED`, `TARGET_PROFILE_MISMATCH`, and the rest. A
send counts only when the page confirms it — the button turning to "Pending" or a
"sent" toast — never because Send was clicked.

`scripts/verify-connect-flow.ts` exercises the nine cases: one Connect, two with
one attributed, two with none (refuse), Follow-only (never Follow), Connect in the
More menu, wrong profile, dialog-without-Send, Send-without-confirmation, and
automatic-sending-off.

## When a run stops

Sending twenty invitations after LinkedIn has started refusing is how an account
gets restricted, so the run gives up early and says why:

- **20 sent.** `MAX_PER_DAY` in `runner.js`, and the day's tally in `store.js` so
  pressing Start twice in an afternoon does not send forty. The server's
  `dailyInviteCap` is the other half of this; neither trusts the other.
- **LinkedIn's own wall.** The weekly-invitation-limit dialog, or a restriction or
  verification prompt, comes back marked `fatal` and ends the batch on the first
  occurrence rather than the third.
- **Three failures in a row.** Usually means LinkedIn changed its markup or the
  account is being throttled.
- **Not signed in to LinkedIn.** The window is open on the login page and the run
  waits there, up to five minutes, including through 2FA. It cannot close the
  window and ask them to press Start again: the profile directory is locked by the
  Chrome that has it open.
- **Already a connection.** An explicit `invite` is skipped. Only `auto` falls back
  to messaging, and only on positive evidence of a connection — a 1st-degree badge
  or a "Remove Connection" item. Without that evidence, no Connect means a selector
  miss, which is reported as **failed**, so three in a row stop the run. Before this
  distinction existed, every selector miss sent a direct message carrying a
  connection-request note to somebody who should have received an invitation.
- **Automatic sending is off.** The run refuses rather than filling boxes nobody
  will click Send on — that was the old extension's failure mode, and it looked
  identical to working. The switch stays in the web app, behind its confirmation.

## Running it in development

```bash
cd desktop
npm install
npm start
```

Then paste a pairing token and set the address to your local server
(`http://localhost:3000`) or `https://app.followthroo.com`.

Chrome itself is not bundled — `runner.js` launches the installed Chrome via
Playwright's `channel: "chrome"`. That keeps the download small and means the
customer gets whatever Chrome they already trust. If Chrome is missing, the run
says so rather than failing obscurely.

**If it dies instantly on `app.whenReady()`:** check `ELECTRON_RUN_AS_NODE`. When
that variable is set, Electron runs as plain Node, `require("electron")` returns
the path to the binary instead of the API, and every destructured import is
`undefined`. The stack trace blames `main.js`, which is the wrong place to look.
Unset it — and if you are spawning Electron from a Node script, delete it from
the child's `env` too, since `spawn` inherits `process.env`.

## Why playwright-core is pinned exactly

`"playwright-core": "1.62.1"` — no caret. The verification scripts live in the
root project and build browser contexts with the root's `@playwright/test`, then
hand them to `runBatch`, which is typed against *this* package.json's copy. Two
different versions means two structurally different `BrowserContext` types and
`npm run typecheck` fails at the repo root with a wall of variance errors that
say nothing about the actual problem. (`^1.62.1` resolved to 1.63.0 and did
exactly that.)

Bump this and the root's `@playwright/test` together, or not at all.

## Verification

```bash
npx tsx scripts/verify-linkedin-target.ts    # right person, right button
npx tsx scripts/verify-desktop-runner.ts     # the loop stops when it should
```

Neither needs a LinkedIn account, a database or a network: a fake Followthroo
answers the queue endpoint and every LinkedIn URL is fulfilled from
`scripts/linkedin-fixtures/profile-with-sidebar.html`.

`verify-desktop-runner.ts` runs twenty real browser iterations to prove the daily
cap, so it takes a few minutes. That is the assertion worth waiting for — a cap
that silently does not hold sends two hundred invitations.

## Building an installer

```bash
cd desktop
npm run dist            # NSIS installer + portable .exe, x64
npm run dist:portable   # just the portable .exe
```

Output lands in `desktop/dist/`.

## Publishing it so customers can download

The build produces two files in `desktop/dist/`, both about 80MB:

| File | Use |
|---|---|
| `followthroo-linkedin-setup-1.0.0.exe` | The installer. Start menu entry, uninstaller, and the one that auto-updates. This is the one to publish. |
| `Followthroo for LinkedIn 1.0.0.exe` | Portable. Runs from wherever it sits, installs nothing. Useful for a locked-down machine or a quick trial — but see Auto-update below: it never self-updates. |

**Do not put either in `public/`.** An 80MB binary there rides along in every
Vercel deployment and lands in git forever. Host it as an object and point
`NEXT_PUBLIC_DESKTOP_APP_URL` at the result — that env var is what turns the
download button on `/dashboard/linkedin` from "ask your admin" into a link.

### Where it lives now

Vercel Blob, in a public store called **`leadskonnect-downloads`** (region `bom1`),
linked to the `leadskonnect` project. `NEXT_PUBLIC_DESKTOP_BLOB_BASE` holds the
store's base URL in production, preview and development:

```text
https://wet59gidjhcn7yck.public.blob.vercel-storage.com
```

One immutable object **per version** under that base:

```text
<base>/followthroo-linkedin-setup-<version>.exe
```

The site never links to a blob directly. `DESKTOP_APP_URL` points at
`/api/desktop/download`, which 302s to `desktopInstallerUrl()` — built from
`DESKTOP_APP_VERSION` in `lib/constants.ts`. That indirection is the whole
release mechanism: bump the constant and the link moves, with no env var to edit
and no `NEXT_PUBLIC_*` rebuild needed to change which file is current.

An earlier arrangement overwrote one fixed pathname
(`followthroo-linkedin-setup.exe`) on every release. Blob objects are served with
a thirty-day cache, so edges kept handing out the previous build: somebody
downloading "the latest" got last week's, and the bug they had just reported was
still there after they reinstalled. Hence one object per version, cached hard and
correctly, with the route as the only mutable part.

### Publishing a new build

Four steps, in order. Skipping the installer upload ships a download button
that 404s; skipping the `latest.yml` upload ships a build nobody's existing
copy will ever hear about (see Auto-update below).

1. Bump `desktop/package.json`, `DESKTOP_APP_VERSION` in `lib/constants.ts` and
   the version badge in `desktop/renderer/index.html` — same commit.
2. Build, from `desktop/`: `npm run dist`.
3. Upload the installer, write-once as before, and `latest.yml`, which is
   meant to be overwritten every time — it's how an already-installed copy
   finds out a newer version exists:

   ```bash
   V=$(node -p "require('./package.json').version")
   RW=$(grep -m1 '^BLOB_READ_WRITE_TOKEN=' ../.env.local | cut -d= -f2- | tr -d '"\r')
   vercel blob put "dist/followthroo-linkedin-setup-$V.exe" \
     --pathname "followthroo-linkedin-setup-$V.exe" \
     --access public --rw-token "$RW"
   vercel blob put "dist/latest.yml" \
     --pathname "latest.yml" \
     --access public --allow-overwrite true --cache-control-max-age 300 \
     --rw-token "$RW"
   ```

4. Deploy the web app, so `/api/desktop/download` redirects to the version
   just uploaded, for anyone downloading fresh.

`nsis.artifactName` in `package.json`'s `build` config names the installer
`followthroo-linkedin-setup-<version>.exe` directly, so what lands in `dist/`
already matches the pathname it needs to be published at — no rename step.
`--publish never` (already in the `dist` script) stops electron-builder from
attempting an automated publish of its own; it still writes `dist/latest.yml`
locally because the `publish` config in `package.json` is present, and that
file is what step 3's second upload needs.

Two flags on the installer upload that are not optional, each of which cost a
failed attempt:

- `--rw-token` — without it the CLI finds `VERCEL_OIDC_TOKEN` in `.env.local`
  but no `BLOB_STORE_ID`, and refuses with a message about setting both or
  neither. Passing the read-write token explicitly sidesteps the whole question.
- `--access public` — required, and the point: a private blob needs a signed URL,
  which a customer clicking a download link does not have.

`--allow-overwrite` stays off the installer. Versioned pathnames are
write-once; needing to overwrite one means a build was published twice under
the same version, which is the thing the caching bug above punished.
`latest.yml` is the deliberate exception — it has no version in its name, has
to change on every release, and `--cache-control-max-age 300` keeps a stale
copy from surviving at the edge for the default 30 days while a machine keeps
asking whether it's up to date.

### Auto-update

`electron-updater` (`main.js`), pointed at the same public Blob store —
`autoUpdater.setFeedURL({ provider: "generic", url: <the base above> })`. The
generic provider is exactly the read-only-feed shape this project already had:
electron-builder never uploads anything on its own, it only writes `latest.yml`
locally, and this project's own `vercel blob put` puts it where the running
app already knows to look.

- **Checked** 8 seconds after the window opens, then every 4 hours, and never
  while a run is in progress (`maybeCheckForUpdates` in `main.js`) — a run owns
  a Chrome window mid-invitation, and an update landing on top of that is
  exactly the surprise `before-quit`'s own prompt exists to prevent elsewhere.
- **Downloaded** automatically once found, in the background. Nothing about
  downloading needs a person's attention.
- **Installed** only on a click. The panel shows a small "Restart to update"
  once the download finishes (`app.js`'s `onUpdate` handler); clicking it
  calls `quitAndInstall`, which itself refuses if a run has started in the
  meantime.
- **No differential downloads.** `autoUpdater.disableDifferentialDownload =
  true` — the blockmap electron-builder generates alongside the installer is
  never uploaded, so a diff has nothing to diff against. Every update is a
  full ~80MB download; simpler to publish correctly than chasing a partial
  transfer that silently falls back to a full one anyway.
- **Only the installed build self-updates.** The portable `.exe` has nowhere
  installed to replace itself into, so someone running it has to notice a new
  version exists on their own — the portable download is for a locked-down
  machine or a quick trial, not for someone who should stay current.
- **Unsigned, same as the installer itself.** electron-updater does not
  require a code-signing certificate to fetch and apply an update; Windows
  SmartScreen's prompt is the same one-time cost described under Code signing
  above, not a new one per update.
- **This version is the floor.** Auto-update only works for someone already
  running a build that has this wiring in it. Anyone on an older installer has
  to download once by hand; from whatever version first shipped this, they
  never have to again.

### The alternatives, and why not

- **Cloudflare R2 / S3** — fine, but new infrastructure to own.
- **GitHub release asset** — free and permanent, but the repo must be **public**.
  `lakshayknows/leadskonnect` is private, so release assets there need a token to
  download and are no use to a customer.

### Sending it to one person today

Before any of that is set up, the built `.exe` can just be sent. Two things to
know: Gmail refuses `.exe` attachments outright, and Google Drive shows an
"can't scan this file" warning on the way down. Zip it first, and tell them about
the SmartScreen prompt below or they will assume it is malware — which, from an
unsigned installer that drives their LinkedIn, is a reasonable thing to assume.

### Code signing

The build is **unsigned**. It installs and runs, but Windows SmartScreen shows
"Windows protected your PC" and the customer has to click *More info → Run
anyway*. Some antivirus engines also flag unsigned browser-automation binaries.

That is a conversion cost, not a technical blocker. When it is worth paying:

- **Azure Trusted Signing** — about $10/month, no hardware token, but the
  business identity must be three years old or more. Cheapest realistic option.
- **Certum** — around €100/year for an individual certificate.
- **Sectigo / DigiCert** — $300–600/year.

Since June 2023 every OV and EV certificate requires hardware or HSM key storage,
which is why the older cheap options are gone. Add `win.certificateSubjectName`
(or the Azure Trusted Signing config) to the `build` block in `package.json` once
a certificate exists.

### Icon

`build/icon.ico` is not committed — electron-builder falls back to the default
Electron icon, so the build works without it. Ship a real one before release:
256×256 or larger, otherwise electron-builder rejects it. `extension/icons/` only
goes up to 128px, so it needs regenerating rather than copying.

## Known gaps

- **Windows only.** electron-builder can target macOS from the same source, but
  it needs an Apple Developer certificate and notarization to be openable at all,
  which is a larger job than the Windows signing above.
- **Auto-update reaches the installed build only** (see Auto-update above).
  The portable `.exe` and anyone still on a pre-1.12.0 installer have to
  download by hand at least once more.
- **The machine has to be on.** Nothing sends overnight or with the laptop shut.
  That is the honest trade for not holding anyone's LinkedIn session.
- **`queueStats` and `stop_all` are org-wide** (`lib/linkedin/queue.ts`,
  `app/api/linkedin/connect/route.ts`), so in a multi-member org the counts shown
  and the "Stop everything" button reach past the signed-in member. Pre-existing,
  unrelated to the desktop move, but it will look like a bug here first.
