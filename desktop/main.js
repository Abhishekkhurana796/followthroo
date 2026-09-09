/**
 * Followthroo for LinkedIn — desktop app.
 *
 * One window, two very different things inside it.
 *
 * The LEFT strip is the sending panel: local HTML, our preload, and the only
 * place `ft.*` exists. The REST is a WebContentsView showing the real hosted web
 * app — leads, campaigns, inbox, all of it — because that app is 18 server
 * components talking to Prisma and there is no version of it to bundle.
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
const store = require("./store");
const { runBatch, MAX_PER_DAY } = require("./runner");

let win = null;
/** The hosted web app. Null until the window exists. */
let webView = null;
/**
 * Panel width in px. Collapsing narrows it to a strip rather than to nothing.
 *
 * Zero looked tidier and was a trap: the only control that brings the panel back
 * lives inside the panel, so hiding it hid the way to unhide it and the app had
 * to be restarted. A strip keeps the toggle on screen.
 */
const PANEL_WIDTH = 400;
const PANEL_COLLAPSED = 44;
let panelWidth = PANEL_WIDTH;
/** True while a batch is in flight. Guards against two runs on one queue. */
let running = false;
let stopRequested = false;
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
    x: panelWidth,
    y: 0,
    width: Math.max(0, width - panelWidth),
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
    backgroundColor: "#fbfaf7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // No preload, no node, and its own nothing. This is remote content we do not
  // control the moment-to-moment contents of, and it must not be able to reach
  // anything the panel can.
  webView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.contentView.addChildView(webView);
  webView.webContents.loadURL(`${appOrigin()}/dashboard`);
  layout();
  win.on("resize", layout);

  // Keep the embedded view on our own app. Anything else — a Google sign-in, a
  // help article, the 80MB installer download link — belongs in the real
  // browser, where the user can see the address bar.
  const external = ({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  };
  win.webContents.setWindowOpenHandler(external);
  webView.webContents.setWindowOpenHandler(external);

  webView.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(appOrigin())) {
      e.preventDefault();
      shell.openExternal(url);
    }
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

// Only one copy may hold the protocol, or a second launch steals the callback
// from the window the person is actually looking at.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const deepLink = argv.find((a) => a.startsWith("followthroo://"));
    if (deepLink) completeSignIn(deepLink);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // macOS delivers it as an event rather than an argv entry.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    completeSignIn(url);
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
  if (deepLink) completeSignIn(deepLink);

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

  const remaining = Math.max(0, MAX_PER_DAY - settings.sentToday);
  try {
    const res = await fetch(`${check.value}/api/linkedin/queue?peek=1&limit=${Math.max(1, remaining)}`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: "Your pairing token was rejected." };
    if (!res.ok || json.ok === false) return { ok: false, error: json.error || `Server returned ${res.status}` };
    return { ok: true, ...json.data, remaining };
  } catch (e) {
    return { ok: false, error: `Can't reach ${check.value} (${String((e && e.message) || e)})` };
  }
});

ipcMain.handle("run:stop", () => {
  stopRequested = true;
  return { ok: true };
});

ipcMain.handle("run:start", async (_e, { dryRun = false } = {}) => {
  if (running) return { ok: false, error: "A run is already going." };

  const userDataPath = app.getPath("userData");
  const settings = store.read(userDataPath);
  if (!settings.token) return { ok: false, error: "Paste your pairing token first." };
  const check = store.normaliseApiBase(settings.apiBase);
  if (!check.ok) return { ok: false, error: check.error };

  // Today's remaining allowance, not a fresh twenty per press. Without this,
  // pressing Start twice in an afternoon would send forty.
  const remaining = Math.max(0, MAX_PER_DAY - settings.sentToday);
  if (remaining === 0 && !dryRun) {
    return { ok: false, error: `Today's ${MAX_PER_DAY} invitations have already gone out. Try again tomorrow.` };
  }

  running = true;
  stopRequested = false;
  // Half an hour of paced waiting is exactly the window in which a laptop
  // decides to sleep and takes the run down with it.
  sleepBlocker = powerSaveBlocker.start("prevent-display-sleep");

  try {
    const summary = await runBatch({
      apiBase: check.value,
      token: settings.token,
      userDataPath,
      limit: dryRun ? MAX_PER_DAY : remaining,
      dryRun,
      noteAllowed: () => store.noteAllowed(userDataPath),
      onNoteUsed: () => store.countNote(userDataPath),
      shouldStop: () => stopRequested,
      onEvent: (evt) => {
        if (evt.type === "action-done" && evt.status === "sent" && !dryRun) {
          store.countSend(userDataPath);
        }
        send("run:event", evt);
      },
    });
    return { ok: true, summary };
  } catch (e) {
    const message = String((e && e.message) || e);
    send("run:event", { type: "fatal", message });
    return { ok: false, error: message };
  } finally {
    running = false;
    if (sleepBlocker !== null && powerSaveBlocker.isStarted(sleepBlocker)) {
      powerSaveBlocker.stop(sleepBlocker);
    }
    sleepBlocker = null;
    send("run:event", { type: "idle" });
  }
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

/** Collapse the panel to give the web app the whole window, and back. */
ipcMain.handle("panel:toggle", (_e, collapsed) => {
  panelWidth = collapsed ? PANEL_COLLAPSED : PANEL_WIDTH;
  layout();
  return { collapsed: panelWidth === PANEL_COLLAPSED };
});

ipcMain.handle("open:external", (_e, url) => {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
});
