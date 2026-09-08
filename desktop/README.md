# Followthroo for LinkedIn — desktop app

Sends a customer's queued LinkedIn invitations from their own computer, on their
own IP, using their own logged-in LinkedIn session.

**Last updated:** 2026-09-07
**Status:** draft

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
| Report outcome | `POST /api/linkedin/queue` with `{ actionId, status, result }` |
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
| `main.js` | Electron main process. Owns the window, the run, and the day's tally. |
| `preload.js` | The only bridge to the renderer. `contextIsolation` on, `nodeIntegration` off. |
| `renderer/` | The control panel — progress, the do-not-touch warning, settings, activity. |
| `runner.js` | The run itself: claim → navigate → act → report, with the stop conditions. |
| `page-actions.js` | What happens on the LinkedIn page. Shared with the verification scripts. |
| `store.js` | Settings and today's count, as JSON in the OS app-data folder. |

`page-actions.js` is the one to be careful with. It runs inside the page, so it
must stay self-contained — no imports, no closure over module scope — because
Playwright serializes it by source. It used to live in `extension/background.js`
and be extracted by brace-matching; it is now a module three callers share, so a
selector fix lands once and the tests exercise the code that ships.

## Two windows, on purpose

The control panel is small and stays the customer's. The window the run opens is
a real Chrome that drives itself, with a red do-not-touch bar pinned to the top of
every page it visits. Keeping them separate is what makes "don't touch that
window" a sentence someone can actually follow.

The banner is `pointer-events: none` and carries `data-followthroo-overlay`, which
`page-actions.js` explicitly excludes from its button search — otherwise a banner
containing the word "Connect" would be clicked instead of LinkedIn's own button on
every single invitation. There is a test for exactly that.

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
- **Not signed in.** The window is already open on the login page; they sign in
  and press Start again. The session persists in the app's own browser profile
  folder from then on.
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
| `Followthroo for LinkedIn Setup 1.0.0.exe` | The installer. Start menu entry, uninstaller. This is the one to publish. |
| `Followthroo for LinkedIn 1.0.0.exe` | Portable. Runs from wherever it sits, installs nothing. Useful for a locked-down machine or a quick trial. |

**Do not put either in `public/`.** An 80MB binary there rides along in every
Vercel deployment and lands in git forever. Host it as an object and point
`NEXT_PUBLIC_DESKTOP_APP_URL` at the result — that env var is what turns the
download button on `/dashboard/linkedin` from "ask your admin" into a link.

### Where it lives now

Vercel Blob, in a public store called **`leadskonnect-downloads`** (region `bom1`),
linked to the `leadskonnect` project. The published URL is:

```text
https://wet59gidjhcn7yck.public.blob.vercel-storage.com/followthroo-linkedin-setup.exe
```

`NEXT_PUBLIC_DESKTOP_APP_URL` is set to that in production, preview and
development.

### Publishing a new build

From `desktop/`, after `npm run dist`:

```bash
RW=$(grep -m1 '^BLOB_READ_WRITE_TOKEN=' ../.env.local | cut -d= -f2- | tr -d '"\r')
vercel blob put "dist/Followthroo for LinkedIn Setup 1.0.0.exe" \
  --pathname followthroo-linkedin-setup.exe \
  --access public --allow-overwrite true --rw-token "$RW"
```

Three flags that are not optional, each of which cost a failed attempt:

- `--rw-token` — without it the CLI finds `VERCEL_OIDC_TOKEN` in `.env.local`
  but no `BLOB_STORE_ID`, and refuses with a message about setting both or
  neither. Passing the read-write token explicitly sidesteps the whole question.
- `--access public` — required, and the point: a private blob needs a signed URL,
  which a customer clicking a download link does not have.
- `--allow-overwrite true` — the pathname must stay
  `followthroo-linkedin-setup.exe` across releases so the env var never changes.
  Without this the upload either fails or lands beside the old one.
  (`--add-random-suffix=false` is documented as the default and did **not**
  prevent a suffix; `--allow-overwrite` is what actually gives a stable name.)

`NEXT_PUBLIC_*` is inlined at build time, so changing that variable needs a
redeploy — but re-uploading to the same pathname does not, which is the reason
for the stable name.

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
- **No auto-update.** LinkedIn changes its markup often, and without an update
  channel a selector fix strands every installed copy. `electron-updater` plus a
  release feed is the next thing this needs.
- **The machine has to be on.** Nothing sends overnight or with the laptop shut.
  That is the honest trade for not holding anyone's LinkedIn session.
- **`queueStats` and `stop_all` are org-wide** (`lib/linkedin/queue.ts`,
  `app/api/linkedin/connect/route.ts`), so in a multi-member org the counts shown
  and the "Stop everything" button reach past the signed-in member. Pre-existing,
  unrelated to the desktop move, but it will look like a bug here first.
