/**
 * Followthroo for LinkedIn — desktop control panel.
 *
 * Two windows, on purpose. This one is small and stays yours: settings,
 * progress, and a Stop button. The one the run opens is a real Chrome that
 * drives itself, and the person is told repeatedly not to touch it. Keeping
 * them separate is what makes "don't touch that window" a sentence anyone can
 * follow — there is a specific window to leave alone, and a different one to
 * watch it from.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require("electron");
const path = require("node:path");
const store = require("./store");
const { runBatch, MAX_PER_DAY } = require("./runner");

let win = null;
/** True while a batch is in flight. Guards against two runs on one queue. */
let running = false;
let stopRequested = false;
/** Keeps the machine awake for the ~30 minutes a full run takes. */
let sleepBlocker = null;

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 660,
    minWidth: 400,
    minHeight: 560,
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

  // Links to the web app open in the real browser, not inside the panel.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

app.whenReady().then(() => {
  createWindow();
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

ipcMain.handle("open:external", (_e, url) => {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
});
