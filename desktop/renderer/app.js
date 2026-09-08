/**
 * Control panel behaviour.
 *
 * Everything on screen is driven by events from the run — there is no polling
 * and no independent notion of state here. If the run says nothing, the panel
 * says nothing new, which is the honest thing to show.
 */
const $ = (id) => document.getElementById(id);

const el = {
  dot: $("dot"), warn: $("warn"), sent: $("sent"), cap: $("cap"), bar: $("bar"),
  now: $("now"), start: $("start"), stop: $("stop"), dry: $("dry"), log: $("log"),
  apiBase: $("apiBase"), token: $("token"), save: $("save"),
  settingsErr: $("settingsErr"), settings: $("settings"),
};

let cap = 20;
let logged = false;
/** The run stated why it ended, so "Done" must not paper over it. */
let ended = false;

function stamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function log(text, status) {
  if (!logged) { el.log.innerHTML = ""; logged = true; }
  const li = document.createElement("li");
  const t = document.createElement("time");
  t.textContent = stamp();
  const s = document.createElement("span");
  s.textContent = text;
  if (status) s.className = `s-${status}`;
  li.append(t, s);
  el.log.prepend(li);
  // The log is a record of one sitting, not a history. Trimming keeps the panel
  // from growing without bound over a long run.
  while (el.log.children.length > 60) el.log.lastElementChild.remove();
}

function setProgress(sent) {
  el.sent.textContent = String(sent);
  el.bar.style.width = `${cap ? Math.min(100, (sent / cap) * 100) : 0}%`;
}

function setRunning(on) {
  el.start.style.display = on ? "none" : "";
  el.stop.style.display = on ? "" : "none";
  el.dry.disabled = on;
  el.warn.classList.toggle("show", on);
  el.dot.className = `dot${on ? " on" : ""}`;
}

async function load() {
  const s = await window.ft.getSettings();
  cap = s.maxPerDay;
  el.cap.textContent = String(cap);
  el.apiBase.value = s.apiBase;
  el.token.value = s.token;
  setProgress(s.sentToday);
  setRunning(s.running);
  // A first run has nothing to send with — open the one place that fixes it
  // rather than letting Start fail with a message about settings.
  if (!s.token) {
    el.settings.open = true;
    el.now.textContent = "Paste your pairing token to get started.";
  }
}

el.save.addEventListener("click", async () => {
  el.settingsErr.textContent = "";
  const res = await window.ft.saveSettings({ apiBase: el.apiBase.value, token: el.token.value });
  if (!res.ok) { el.settingsErr.textContent = res.error; return; }
  el.apiBase.value = res.settings.apiBase;
  el.now.textContent = "Saved. Press Start when you're ready to step away.";
  log("Settings saved.");
});

async function begin(dryRun) {
  ended = false;
  el.settingsErr.textContent = "";
  setRunning(true);
  el.now.textContent = dryRun ? "Test run — nothing will actually be sent." : "Starting…";
  log(dryRun ? "Test run started — nothing will be sent." : "Run started.");
  const res = await window.ft.start({ dryRun });
  if (!res.ok) {
    setRunning(false);
    el.now.textContent = res.error;
    el.dot.className = "dot err";
    log(res.error, "failed");
  }
}

el.start.addEventListener("click", () => begin(false));
el.dry.addEventListener("click", () => begin(true));
el.stop.addEventListener("click", async () => {
  el.stop.disabled = true;
  el.now.textContent = "Stopping after this one…";
  await window.ft.stop();
  el.stop.disabled = false;
});

window.ft.onEvent((evt) => {
  switch (evt.type) {
    case "status":
      el.now.textContent = evt.message;
      break;
    case "needs-signin":
      // Not a failure — the run is waiting on a person, and will carry on by
      // itself once they are through. A red dot here would say "broken" about
      // the one moment that needs them to act.
      el.now.textContent = evt.message;
      log(evt.message);
      break;
    case "action-start":
      el.now.textContent = `Opening ${evt.who}…`;
      break;
    case "action-done":
      setProgress(evt.sent);
      log(`${evt.who} — ${evt.result}`, evt.status);
      break;
    case "waiting":
      setProgress(evt.sent);
      break;
    case "tick":
      el.now.textContent = `Waiting ${evt.remaining}s before the next one — this pause is what keeps the account safe.`;
      break;
    case "fatal":
      el.now.textContent = evt.message;
      el.dot.className = "dot err";
      log(evt.message, "failed");
      ended = true;
      break;
    case "done": {
      const parts = [`${evt.sent} sent`];
      if (evt.failed) parts.push(`${evt.failed} failed`);
      if (evt.skipped) parts.push(`${evt.skipped} skipped`);
      log(`Finished — ${parts.join(", ")}.`, evt.sent ? "sent" : undefined);
      // The run's own account of why it ended is the authoritative one. Keep it.
      if (evt.stoppedBecause) {
        el.now.textContent = evt.stoppedBecause;
        ended = true;
      }
      break;
    }
    case "idle":
      setRunning(false);
      el.warn.classList.remove("show");
      // Only overwrite a neutral message. A run that ended on a reason — a
      // limit, a rejected token, a wall — must keep saying so; replacing that
      // with "Done" is how someone concludes it worked.
      if (!ended) el.now.textContent = "Done. You can use your computer again.";
      ended = false;
      break;
  }
});

load();
