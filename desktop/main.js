/**
 * Followthroo for LinkedIn — desktop app.
 *
 * One window, two very different things inside it.
 *
 * The local Automation page and the hosted web app take turns using the window.
 * A 44px local rail remains when the web app is visible so there is always a
 * trusted way back. Only the local page has `ft.*`.
 *
 * The separation is a security boundary, not a layout choice. The panel's
 * preload can start browser automation against the user's LinkedIn; attaching it
 * to remote content would hand that to anything the page loads. The web view
 * therefore gets no preload at all.
 *
 * A third window appears during a run: the Chrome that Playwright drives. That
 * one is the one to leave alone, and it says so across the top of every page.
 */
const {
  app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, powerSaveBlocker, session,
} = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { autoUpdater } = require("electron-updater");
const store = require("./store");
const { isAppUrl, isProviderSignIn } = require("./navigation");
const { runBatch, MAX_PER_DAY } = require("./runner");
const { runEnrichmentBatch } = require("./enrich-flow");
const { requestJson } = require("./api-client");

let win = null;
/** The hosted web app. Null until the window exists. */
let webView = null;
/** The trusted local rail left visible beside the hosted web app. */
const AUTOMATION_RAIL = 44;
let showingWebApp = false;
/** True while a batch is in flight. Guards against two runs on one queue. */
let running = false;
let runningMode = null;
let runningCampaignId = null;
let stopRequested = false;
let pendingCampaignId = null;
/** Keeps the machine awake for the ~30 minutes a full run takes. */
let sleepBlocker = null;

/** The hosts the embedded view is allowed to be. */
function appOrigin() {
  const check = store.normaliseApiBase(store.read(app.getPath("userData")).apiBase);
  return check.ok ? check.value : "https://app.followthroo.com";
}

function layout() {
  if (!win || win.isDestroyed() || !webView) return;
  const { width, height } = win.getContentBounds();
  webView.setBounds({
    x: showingWebApp ? AUTOMATION_RAIL : width,
    y: 0,
    width: showingWebApp ? Math.max(0, width - AUTOMATION_RAIL) : 0,
    height,
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Followthroo for LinkedIn",
    backgroundColor: "#fbfbfb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.on("did-finish-load", () => {
    if (pendingCampaignId) send("campaign:select", { campaignId: pendingCampaignId });
  });

  // No preload, no node, and its own nothing. This is remote content we do not
  // control the moment-to-moment contents of, and it must not be able to reach
  // anything the panel can.
  webView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Lets the web app tell it is in here, so its sign-in page can offer the
  // browser handoff instead of Google and Zoho buttons that cannot work.
  // Appended, not replaced — and nothing of Google's ever loads in this view, so
  // it is not the spoofing the sign-in comment further down rules out.
  webView.webContents.setUserAgent(`${webView.webContents.getUserAgent()} FollowthrooDesktop/${app.getVersion()}`);
  win.contentView.addChildView(webView);
  webView.webContents.loadURL(`${appOrigin()}/dashboard`);
  layout();
  win.on("resize", layout);

  // Keep the embedded view on our own app. Anything else — a help article, the
  // 80MB installer download link — belongs in the real browser, where the user
  // can see the address bar.
  //
  // A Google or Zoho sign-in is the exception. Opening the provider's own URL in
  // the browser signed the browser in and left this app signed out, because
  // nothing on that path ever reaches /desktop-auth. It starts the same handoff
  // as the panel's Sign in button instead.
  const external = ({ url }) => {
    if (isProviderSignIn(url)) startExternalSignIn();
    else if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  };
  win.webContents.setWindowOpenHandler(external);
  webView.webContents.setWindowOpenHandler(external);

  webView.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url, appOrigin())) return;
    e.preventDefault();
    if (isProviderSignIn(url)) startExternalSignIn();
    else shell.openExternal(url);
  });

  // A server-side redirect does not fire will-navigate. A sign-in link that went
  // through one on its way to Google would otherwise load Google's page right
  // here, which Google refuses.
  webView.webContents.on("will-redirect", (e, url) => {
    if (!isProviderSignIn(url)) return;
    e.preventDefault();
    startExternalSignIn();
  });

  // Once the web app has a session, we can pair without anyone pasting a token.
  webView.webContents.on("did-finish-load", () => {
    autoPair().catch(() => {});
  });
}

/**
 * Pick up the pairing token from the signed-in session.
 *
 * `GET /api/linkedin/connect` returns `extToken` to a session-authenticated
 * caller and creates the account row if it does not exist yet. So once someone
 * is signed in to the embedded web app, the runner's credential can simply be
 * fetched — there is no reason to make them find Settings, reveal a token and
 * copy it across. Manual paste stays as the fallback for anyone pointing at a
 * different deployment.
 */
async function autoPair() {
  const userDataPath = app.getPath("userData");
  const current = store.read(userDataPath);
  const origin = appOrigin();

  const cookies = await session.defaultSession.cookies.get({ url: origin });
  const hasSession = cookies.some((c) => /better-auth\.session_token$/.test(c.name));
  if (!hasSession) return;

  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${origin}/api/linkedin/connect`, { headers: { Cookie: cookieHeader } });
  if (!res.ok) return;
  const json = await res.json().catch(() => null);
  const token = json?.data?.extToken;
  if (!token || token === current.token) return;

  store.write(userDataPath, { token, apiBase: origin });
  send("run:event", { type: "paired" });
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/* ------------------------------------------------------------------ */
/* Keeping the app itself up to date                                    */
/* ------------------------------------------------------------------ */

/**
 * The same public Vercel Blob store the installer is published to (see
 * desktop/README.md's "Publishing a new build"). Not read from settings like
 * `apiBase` — the update feed is a property of which build shipped, not of
 * which Followthroo deployment someone points it at, so it is fixed the way
 * the app's own identity is.
 */
const UPDATE_FEED_URL = "https://wet59gidjhcn7yck.public.blob.vercel-storage.com";

// No blockmap is published alongside the installer (see the README), so a
// differential download would have nothing to diff against and electron-
// updater would have to fall back to a full download anyway. Asking for it
// up front skips a request that can only fail.
autoUpdater.disableDifferentialDownload = true;
// Fetch the new installer as soon as one is found; only *running* it still
// needs a click (see update:install below) and never happens mid-run.
autoUpdater.autoDownload = true;
// quitAndInstall below is the only path that may ever install an update, and
// only once a run cannot be in progress — never on a bare app quit.
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_FEED_URL, channel: "latest" });

autoUpdater.on("update-available", (info) => send("update:event", { type: "available", version: info.version }));
autoUpdater.on("update-not-available", () => send("update:event", { type: "none" }));
autoUpdater.on("download-progress", (p) =>
  send("update:event", { type: "downloading", percent: Math.round(p.percent) })
);
autoUpdater.on("update-downloaded", (info) => send("update:event", { type: "ready", version: info.version }));
autoUpdater.on("error", (e) => send("update:event", { type: "error", message: String((e && e.message) || e) }));

/**
 * A run owns a Chrome window mid-invitation; an update landing on top of that
 * is exactly the kind of surprise `before-quit` already exists to prevent. So
 * checking is skipped outright while one is in flight, rather than checking
 * and then hoping nobody clicks Restart until it ends.
 */
function maybeCheckForUpdates() {
  // electron-updater expects a packaged, versioned install to compare against
  // the feed. `npm start` runs the source directly under a stock Electron
  // build, which isn't one — it would just fail on every launch in
  // development, so there is nothing to update there.
  if (!app.isPackaged || running) return;
  autoUpdater
    .checkForUpdates()
    .catch((e) => send("update:event", { type: "error", message: String((e && e.message) || e) }));
}

/* ------------------------------------------------------------------ */
/* Signing in through the real browser                                  */
/* ------------------------------------------------------------------ */

/**
 * Google will not accept an embedded browser. It checks the user agent and
 * refuses Electron with "this browser or app may not be secure", and the
 * sign-in page leads with the Google button — so a meaningful share of people
 * would hit a dead end. Spoofing the user agent is the usual dodge and is
 * exactly what the check exists to catch.
 *
 * So sign-in happens in the system browser, where Google is content, and comes
 * back through a `followthroo://` link carrying a single-use code. Zoho and
 * email/password go the same way, because one flow that always works beats two
 * that mostly do.
 */
function startExternalSignIn() {
  const origin = appOrigin();
  shell.openExternal(`${origin}/sign-in?redirect=${encodeURIComponent("/desktop-auth")}`);
}

/** Redeem the code the browser handed back, and adopt the session. */
async function completeSignIn(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const code = url.searchParams.get("code");
    if (!code) return;

    const origin = appOrigin();
    const res = await fetch(`${origin}/api/desktop/handoff`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      send("run:event", { type: "signin-failed", message: json.error || "That sign-in link did not work." });
      return;
    }

    // Same name and attributes better-auth sets, so the web app reads it as its
    // own. Secure + httpOnly because it is exactly as sensitive here as it is in
    // a browser.
    const secure = origin.startsWith("https://");
    await session.defaultSession.cookies.set({
      url: origin,
      name: `${secure ? "__Secure-" : ""}better-auth.session_token`,
      value: json.data.sessionToken,
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expirationDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });

    if (webView) webView.webContents.loadURL(`${origin}/dashboard`);
    send("run:event", { type: "signed-in" });
  } catch (e) {
    send("run:event", { type: "signin-failed", message: String((e && e.message) || e) });
  }
}

/** Route protocol links without letting a campaign handoff impersonate auth. */
function handleDeepLink(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "linkedin") {
      const match = url.pathname.match(/^\/campaign\/([^/]+)$/);
      if (!match) return;
      pendingCampaignId = decodeURIComponent(match[1]);
      showingWebApp = false;
      layout();
      send("campaign:select", { campaignId: pendingCampaignId });
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      return;
    }
    completeSignIn(rawUrl);
  } catch (_) {}
}

// Only one copy may hold the protocol, or a second launch steals the callback
// from the window the person is actually looking at.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const deepLink = argv.find((a) => a.startsWith("followthroo://"));
    if (deepLink) handleDeepLink(deepLink);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // macOS delivers it as an event rather than an argv entry.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleDeepLink(url);
  });
}

app.whenReady().then(() => {
  // In development the executable is Electron itself, so the protocol has to
  // name this project's entry point or Windows registers a handler that opens a
  // bare Electron.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("followthroo", process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient("followthroo");
  }

  // Downloads started inside the app — the "Download for Windows" button being
  // the obvious one — go to the real browser rather than trying to install this
  // app from inside itself. Registered once on the shared session: inside
  // createWindow it would stack a second handler if the window were ever
  // recreated, and each one calls openExternal.
  session.defaultSession.on("will-download", (e, item) => {
    e.preventDefault();
    shell.openExternal(item.getURL());
  });

  createWindow();

  // A cold start launched by the protocol carries the URL in argv.
  const deepLink = process.argv.find((a) => a.startsWith("followthroo://"));
  if (deepLink) handleDeepLink(deepLink);

  // A few seconds after open, so an update check never competes with the
  // pairing and queue calls a fresh window already makes on load. After that,
  // every few hours — long enough that a person who leaves the app open for a
  // day still gets a build shipped that morning, short enough that "download
  // the new version" is never the reason a run was refused.
  setTimeout(maybeCheckForUpdates, 8_000);
  setInterval(maybeCheckForUpdates, 4 * 60 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * A run in progress owns a Chrome window and a slice of the day's quota.
 * Quitting mid-invitation would strand the action as in_progress on the server
 * for fifteen minutes, so closing asks first.
 */
app.on("before-quit", (e) => {
  if (!running) return;
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Keep sending", "Stop and quit"],
    defaultId: 0,
    cancelId: 0,
    title: "Invites are still going out",
    message: "A run is in progress.",
    detail: "Quitting now stops it partway through. Anything already sent stays sent.",
  });
  if (choice === 0) e.preventDefault();
  else stopRequested = true;
});

ipcMain.handle("settings:get", () => ({
  ...store.read(app.getPath("userData")),
  maxPerDay: MAX_PER_DAY,
  running,
  runningMode,
  runningCampaignId,
  version: app.getVersion(),
}));

ipcMain.handle("settings:save", (_e, patch) => {
  if (patch.apiBase !== undefined) {
    const check = store.normaliseApiBase(patch.apiBase);
    if (!check.ok) return { ok: false, error: check.error };
    patch.apiBase = check.value;
  }
  if (patch.token !== undefined) patch.token = String(patch.token).trim();
  return { ok: true, settings: store.write(app.getPath("userData"), patch) };
});

/**
 * Who is queued, before anything is sent.
 *
 * The panel used to show a number and a Start button, which meant pressing Start
 * fired irrevocable invitations at a list nobody had seen. This is a read — the
 * server's `peek` does not claim anything — so it is safe to call whenever the
 * panel is open.
 */
ipcMain.handle("queue:peek", async () => {
  const settings = store.read(app.getPath("userData"));
  if (!settings.token) return { ok: false, error: "No pairing token yet." };
  const check = store.normaliseApiBase(settings.apiBase);
  if (!check.ok) return { ok: false, error: check.error };

  try {
    const data = await requestJson(check.value, "/api/linkedin/queue?peek=1&limit=50", {
      token: settings.token,
      operation: "Read invitation queue",
      retry: "read",
    });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

function desktopIdentity(userDataPath) {
  const current = store.read(userDataPath);
  if (typeof current.deviceId === "string" && current.deviceId.length >= 8) return current.deviceId;
  const deviceId = randomUUID();
  store.write(userDataPath, { deviceId });
  return deviceId;
}

/** Campaign summaries are server-owned; the renderer never receives a session token. */
ipcMain.handle("campaign:list", async () => {
  const settings = store.read(app.getPath("userData"));
  if (!settings.token) return { ok: false, error: "No pairing token yet." };
  const check = store.normaliseApiBase(settings.apiBase);
  if (!check.ok) return { ok: false, error: check.error };
  try {
    const data = await requestJson(check.value, "/api/linkedin/campaigns", {
      token: settings.token,
      operation: "Read LinkedIn campaigns",
      retry: "read",
    });
    return { ok: true, ...data, interruptedCampaignId: settings.activeCampaignId || null };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle("campaign:control", async (_e, { campaignId, action } = {}) => {
  if (typeof campaignId !== "string" || !campaignId) return { ok: false, error: "Choose a campaign." };
  if (!["pause", "resume", "stop"].includes(action)) return { ok: false, error: "Choose pause, resume, or stop." };
  const settings = store.read(app.getPath("userData"));
  const check = store.normaliseApiBase(settings.apiBase);
  if (!settings.token) return { ok: false, error: "No pairing token yet." };
  if (!check.ok) return { ok: false, error: check.error };
  if ((action === "pause" || action === "stop") && runningCampaignId === campaignId) stopRequested = true;
  try {
    const data = await requestJson(check.value, "/api/linkedin/campaigns", {
      method: "PATCH",
      token: settings.token,
      body: { campaignId, action },
      operation: `${action} LinkedIn campaign`,
    });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/** Read contact lookups independently from the invitation queue. */
ipcMain.handle("enrich:peek", async () => {
  const settings = store.read(app.getPath("userData"));
  if (!settings.token) return { ok: false, error: "No pairing token yet." };
  const check = store.normaliseApiBase(settings.apiBase);
  if (!check.ok) return { ok: false, error: check.error };

  try {
    const data = await requestJson(check.value, "/api/linkedin/enrich/peek?limit=50", {
      token: settings.token,
      operation: "Read contact lookup queue",
      retry: "read",
    });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/**
 * Switch a queued invitation's note on or off, or change what it says, from the
 * Up next list.
 *
 * The server only allows it while the invitation is still pending, so this
 * cannot race a run that has already picked it up — it gets told no instead.
 */
ipcMain.handle("queue:setNote", async (_e, { id, noteChoice, note } = {}) => {
  const settings = store.read(app.getPath("userData"));
  if (!settings.token) return { ok: false, error: "No pairing token yet." };
  const check = store.normaliseApiBase(settings.apiBase);
  if (!check.ok) return { ok: false, error: check.error };
  if (typeof id !== "string" || !id) return { ok: false, error: "Which invitation?" };

  const body = {};
  if (noteChoice === "yes" || noteChoice === "no") body.noteChoice = noteChoice;
  if (typeof note === "string") body.note = note;
  try {
    const data = await requestJson(check.value, `/api/linkedin/invitations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: settings.token,
      body,
      operation: "Update invitation note",
    });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle("run:stop", () => {
  stopRequested = true;
  return { ok: true };
});

ipcMain.handle("run:start", async (_e, { mode = "invite", dryRun = false, campaignId = null } = {}) => {
  if (running) return { ok: false, error: "A run is already going." };
  if (mode !== "invite" && mode !== "enrich") return { ok: false, error: "Choose invitations or contact lookups." };
  if (mode === "enrich" && dryRun) return { ok: false, error: "Contact lookups do not have a test mode." };

  const userDataPath = app.getPath("userData");
  const settings = store.read(userDataPath);
  if (!settings.token) return { ok: false, error: "Paste your pairing token first." };
  const check = store.normaliseApiBase(settings.apiBase);
  if (!check.ok) return { ok: false, error: check.error };

  if (campaignId !== null && (typeof campaignId !== "string" || !campaignId)) {
    return { ok: false, error: "Choose a valid campaign." };
  }

  let runId = null;
  let heartbeat = null;
  let sessionFailure = false;
  let invitationUsage = null;
  if (mode === "invite") {
    try {
      const campaignQuery = campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : "";
      const peek = await requestJson(check.value, `/api/linkedin/queue?peek=1&limit=1${campaignQuery}`, {
        token: settings.token,
        operation: "Read invitation limit",
        retry: "read",
      });
      invitationUsage = peek.usage;
    } catch (e) {
      return { ok: false, error: `Could not read today's invitation limit: ${String((e && e.message) || e)}` };
    }
    if (!dryRun && (!invitationUsage || invitationUsage.remaining <= 0)) {
      const cap = invitationUsage?.cap ?? MAX_PER_DAY;
      return { ok: false, error: `Today's ${cap} invitations have already gone out. Try again tomorrow.` };
    }
  }

  if (mode === "invite" && !dryRun) {
    if (campaignId) {
      try {
        await requestJson(check.value, "/api/linkedin/campaigns", {
          method: "PATCH", token: settings.token, body: { campaignId, action: "resume" }, operation: "Resume LinkedIn campaign",
        });
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
    runId = randomUUID();
    try {
      await requestJson(check.value, "/api/linkedin/desktop-run", {
        method: "POST",
        token: settings.token,
        body: { action: "acquire", runId, deviceId: desktopIdentity(userDataPath), campaignId },
        operation: "Reserve LinkedIn desktop run",
      });
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    store.write(userDataPath, { activeCampaignId: campaignId || null });
  }

  running = true;
  runningMode = mode;
  runningCampaignId = campaignId;
  stopRequested = false;
  // Half an hour of paced waiting is exactly the window in which a laptop
  // decides to sleep and takes the run down with it.
  sleepBlocker = powerSaveBlocker.start("prevent-display-sleep");

  if (runId) {
    // The lease lives 120s and renews every 30s. A 409 means the server has
    // handed the run to someone else, so stop at once. Anything else is the
    // network, and one dropped request used to stop the run and pause the
    // campaign despite three more renewals of slack — so only give up once the
    // lease could genuinely have lapsed, and well before another desktop could
    // legitimately take it.
    const LEASE_GIVE_UP_MS = 90_000;
    let lastRenewedAt = Date.now();
    heartbeat = setInterval(async () => {
      try {
        await requestJson(check.value, "/api/linkedin/desktop-run", {
          method: "POST", token: settings.token, body: { action: "heartbeat", runId }, operation: "Keep LinkedIn run reserved", retry: "idempotent",
        });
        lastRenewedAt = Date.now();
      } catch (e) {
        const lost = !!e && e.httpStatus === 409;
        if (!lost && Date.now() - lastRenewedAt < LEASE_GIVE_UP_MS) return;
        stopRequested = true;
        sessionFailure = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        send("run:event", {
          type: "fatal",
          lane: mode,
          campaignId,
          message: lost
            ? "Another computer took over this LinkedIn run. Stopping safely after the current profile."
            : "Lost connection to Followthroo for over a minute. Stopping safely after the current profile.",
        });
      }
    }, 30_000);
  }

  try {
    const common = {
      apiBase: check.value,
      token: settings.token,
      userDataPath,
      version: app.getVersion(),
      shouldStop: () => stopRequested,
      onEvent: (evt) => send("run:event", { lane: mode, ...evt }),
    };
    const summary = mode === "enrich"
      ? await runEnrichmentBatch({ ...common, limit: 30 })
      : await runBatch({
          ...common,
          limit: dryRun ? invitationUsage?.cap ?? MAX_PER_DAY : invitationUsage.remaining,
          dryRun,
          campaignId,
          runId,
          // The API has already decided which claimed actions may carry a note.
          // Local disk state is never an authority for LinkedIn limits.
          noteAllowed: () => true,
          onNoteUsed: () => {},
          connectionsCheckDue: () => store.connectionsCheckDue(userDataPath),
          onConnectionsChecked: () => store.markConnectionsChecked(userDataPath),
          onEvent: (evt) => {
            if (evt.type === "fatal") sessionFailure = true;
            const total = typeof evt.sent === "number" && invitationUsage ? invitationUsage.used + evt.sent : evt.sent;
            send("run:event", { lane: mode, ...evt, sent: total, cap: invitationUsage?.cap });
          },
        });
    if (campaignId && sessionFailure) {
      await requestJson(check.value, "/api/linkedin/campaigns", {
        method: "PATCH", token: settings.token, body: { campaignId, action: "pause" }, operation: "Pause LinkedIn campaign after a session failure",
      }).catch(() => {});
    }
    return { ok: true, summary };
  } catch (e) {
    const message = String((e && e.message) || e);
    send("run:event", { type: "fatal", lane: mode, message });
    return { ok: false, error: message };
  } finally {
    running = false;
    runningMode = null;
    runningCampaignId = null;
    if (heartbeat) clearInterval(heartbeat);
    if (runId) {
      await requestJson(check.value, "/api/linkedin/desktop-run", {
        method: "POST", token: settings.token, body: { action: "release", runId }, operation: "Release LinkedIn desktop run",
      }).catch(() => {});
      store.write(userDataPath, { activeCampaignId: null });
    }
    if (sleepBlocker !== null && powerSaveBlocker.isStarted(sleepBlocker)) {
      powerSaveBlocker.stop(sleepBlocker);
    }
    sleepBlocker = null;
    send("run:event", { type: "idle", lane: mode });
  }
});

/**
 * Restart into the downloaded update. Refuses during a run for the same
 * reason `before-quit` does — an invitation mid-flight, on a Chrome window
 * about to be torn down. `quitAndInstall` only runs at all once this returns
 * ok, so by the time it fires `running` is already false and `before-quit`'s
 * own prompt never has a reason to appear.
 */
ipcMain.handle("update:install", () => {
  if (running) return { ok: false, error: "Wait for the current run to finish first." };
  // isSilent, isForceRunAfterSilentInstall — the NSIS installer wizard (this
  // app is `oneClick: false`) is for someone doing it by hand; a click on
  // "Restart to update" should not open it again for a choice already made.
  autoUpdater.quitAndInstall(true, true);
  return { ok: true };
});

ipcMain.handle("auth:signin", () => {
  startExternalSignIn();
  return { ok: true };
});

ipcMain.handle("auth:status", async () => {
  const origin = appOrigin();
  const cookies = await session.defaultSession.cookies.get({ url: origin });
  return { signedIn: cookies.some((c) => /better-auth\.session_token$/.test(c.name)), origin };
});

/** Switch between the trusted local Automation page and hosted web app. */
ipcMain.handle("panel:toggle", (_e, collapsed) => {
  showingWebApp = !!collapsed;
  layout();
  return { collapsed: showingWebApp };
});

ipcMain.handle("open:external", (_e, url) => {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
});
