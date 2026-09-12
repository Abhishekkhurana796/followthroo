/**
 * The only bridge between the control panel and the machine.
 *
 * contextIsolation is on and nodeIntegration is off, so the renderer has no
 * filesystem, no child processes and no network beyond what is listed here.
 * The renderer is HTML we wrote, but it is also the surface where a pasted
 * token and a URL arrive, and there is no reason for it to be able to do more
 * than ask this file to act.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ft", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  peekQueue: () => ipcRenderer.invoke("queue:peek"),
  /** { id, noteChoice?: "yes" | "no", note?: string } — only while the invitation is still pending. */
  setNote: (patch) => ipcRenderer.invoke("queue:setNote", patch),
  signIn: () => ipcRenderer.invoke("auth:signin"),
  authStatus: () => ipcRenderer.invoke("auth:status"),
  togglePanel: (collapsed) => ipcRenderer.invoke("panel:toggle", collapsed),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  start: (opts) => ipcRenderer.invoke("run:start", opts),
  stop: () => ipcRenderer.invoke("run:stop"),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  /** Progress from the run. Returns an unsubscribe so a re-render cannot stack listeners. */
  onEvent: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on("run:event", listener);
    return () => ipcRenderer.removeListener("run:event", listener);
  },
  installUpdate: () => ipcRenderer.invoke("update:install"),
  /** Same pattern as onEvent, on its own channel — an update is not a run. */
  onUpdate: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on("update:event", listener);
    return () => ipcRenderer.removeListener("update:event", listener);
  },
});
