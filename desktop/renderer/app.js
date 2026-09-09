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
  who: $("who"), whoCount: $("whoCount"), whoNote: $("whoNote"),
  signin: $("signin"), signinBtn: $("signinBtn"), collapse: $("collapse"),
  reload: $("reload"),
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

/**
 * Show exactly who is queued.
 *
 * Start is irreversible — an invitation cannot be recalled — so the names belong
 * on screen before the button is pressed, not in a log afterwards. The Start
 * label counts them too, so "Send 14 invitations" is what you agree to rather
 * than a generic "Start sending".
 */
async function loadQueue() {
  const res = await window.ft.peekQueue();

  if (!res.ok) {
    el.who.innerHTML = "";
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = res.error;
    el.who.appendChild(li);
    el.whoCount.textContent = "";
    el.whoNote.textContent = "";
    el.start.disabled = true;
    el.start.textContent = "Start sending";
    return;
  }

  const people = res.people || [];
  el.who.innerHTML = "";
  el.whoCount.textContent = people.length ? `· ${people.length}` : "";

  if (!people.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "Nothing queued. Pick people in Followthroo → Leads and press “Connect on LinkedIn”.";
    el.who.appendChild(li);
    el.whoNote.textContent = "";
    el.start.disabled = true;
    el.start.textContent = "Nothing to send";
    return;
  }

  people.forEach((p, i) => {
    const li = document.createElement("li");

    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(i + 1);

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.leadName || p.linkedinUrl;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [p.title, p.company].filter(Boolean).join(" · ") || p.linkedinUrl;
    body.append(name, meta);

    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = p.type === "message" ? "Message" : "Invite";

    li.append(n, body, kind);
    el.who.appendChild(li);
  });

  const mins = Math.round((people.length * ((res.pacing?.minDelaySec ?? 45) + (res.pacing?.maxDelaySec ?? 120))) / 2 / 60);
  el.whoNote.textContent = res.autoSend
    ? `About ${mins} minute${mins === 1 ? "" : "s"}, paced ${res.pacing?.minDelaySec ?? 45}–${res.pacing?.maxDelaySec ?? 120} seconds apart.`
    : "Automatic sending is off in Followthroo, so a run will refuse to start.";

  el.start.disabled = false;
  el.start.textContent = `Send ${people.length} ${people.length === 1 ? "invitation" : "invitations"}`;
}

/**
 * Sign-in state drives what the panel offers.
 *
 * Signed in, the token arrives by itself and Settings is a fallback nobody needs
 * to open. Signed out, asking someone to paste a pairing token they cannot reach
 * is a dead end, so the only thing offered is the way out of it.
 */
async function refreshAuth() {
  const { signedIn } = await window.ft.authStatus();
  el.signin.style.display = signedIn ? "none" : "block";
  return signedIn;
}

el.signinBtn.addEventListener("click", async () => {
  el.signinBtn.disabled = true;
  el.signinBtn.textContent = "Opening your browser…";
  await window.ft.signIn();
  setTimeout(() => {
    el.signinBtn.disabled = false;
    el.signinBtn.textContent = "Sign in";
  }, 4000);
});

let collapsed = false;
async function setCollapsed(next) {
  const res = await window.ft.togglePanel(next);
  collapsed = res.collapsed;
  // The body class is what leaves a strip behind rather than nothing at all —
  // the reopen button is the only thing still rendered, and it is the only way
  // back.
  document.body.classList.toggle("collapsed", collapsed);
  el.collapse.textContent = collapsed ? "Show this panel" : "Hide this panel";
}
el.collapse.addEventListener("click", () => setCollapsed(!collapsed));
document.getElementById("reopen").addEventListener("click", () => setCollapsed(false));

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
  refreshAuth();
  loadQueue();
}

el.save.addEventListener("click", async () => {
  el.settingsErr.textContent = "";
  const res = await window.ft.saveSettings({ apiBase: el.apiBase.value, token: el.token.value });
  if (!res.ok) { el.settingsErr.textContent = res.error; return; }
  el.apiBase.value = res.settings.apiBase;
  el.now.textContent = "Saved. Press Start when you're ready.";
  log("Settings saved.");
  loadQueue();
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

el.reload.addEventListener("click", async () => {
  el.reload.disabled = true;
  await loadQueue();
  // Long enough to read as a response rather than nothing happening.
  setTimeout(() => (el.reload.disabled = false), 400);
});

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
      // Where to find the record of what happened, for when it did not work.
      if (evt.logFile) log(`Details saved to ${evt.logFile}`);
      // The run's own account of why it ended is the authoritative one. Keep it.
      if (evt.stoppedBecause) {
        el.now.textContent = evt.stoppedBecause;
        ended = true;
      }
      break;
    }
    case "paired":
      // The token arrived from the signed-in session; nobody had to paste it.
      load();
      log("Paired with your Followthroo account.");
      break;
    case "signed-in":
      refreshAuth();
      load();
      log("Signed in.");
      break;
    case "signin-failed":
      el.now.textContent = evt.message;
      el.dot.className = "dot err";
      log(evt.message, "failed");
      break;
    case "idle":
      setRunning(false);
      el.warn.classList.remove("show");
      // Only overwrite a neutral message. A run that ended on a reason — a
      // limit, a rejected token, a wall — must keep saying so; replacing that
      // with "Done" is how someone concludes it worked.
      if (!ended) el.now.textContent = "Done.";
      ended = false;
      // The queue moved — whatever went out is no longer waiting.
      loadQueue();
      break;
  }
});

load();
