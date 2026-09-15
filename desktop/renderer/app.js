const $ = (id) => document.getElementById(id);
const el = {
  dot: $("dot"), reload: $("reload"), warn: $("warn"), version: $("version"),
  sent: $("sent"), cap: $("cap"), inviteBar: $("inviteBar"), inviteNow: $("inviteNow"),
  inviteStatus: $("inviteStatus"), inviteWho: $("inviteWho"), inviteCount: $("inviteCount"), inviteNote: $("inviteNote"),
  inviteStart: $("inviteStart"), inviteStop: $("inviteStop"), inviteDry: $("inviteDry"),
  enrichUsed: $("enrichUsed"), enrichCap: $("enrichCap"), enrichBar: $("enrichBar"), enrichNow: $("enrichNow"),
  enrichStatus: $("enrichStatus"), enrichWho: $("enrichWho"), enrichCount: $("enrichCount"), enrichNote: $("enrichNote"),
  enrichStart: $("enrichStart"), enrichStop: $("enrichStop"),
  notesChip: $("notesChip"), notesLeft: $("notesLeft"), log: $("log"),
  apiBase: $("apiBase"), token: $("token"), save: $("save"), settings: $("settings"), settingsErr: $("settingsErr"),
  signin: $("signin"), signinBtn: $("signinBtn"), collapse: $("collapse"), reopen: $("reopen"), webSwitch: $("webSwitch"),
  update: $("update"), updateText: $("updateText"), updateBtn: $("updateBtn"),
  campaignPanel: $("campaignPanel"), campaignList: $("campaignList"), campaignConnection: $("campaignConnection"),
};

let inviteCap = 20;
let activeLane = null;
let logged = false;
let selectedCampaignId = null;
let activeCampaignRunId = null;
let campaigns = [];
/** The campaign this computer was running when it last closed without finishing, per main.js. */
let interruptedCampaignId = null;
/** Who the running campaign is contacting now, from the runner's action-start event. */
let currentWho = null;
const ended = { invite: false, enrich: false };
const NOTE_MAX = 300;

function stamp() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function log(text, status, lane) {
  if (!logged) { el.log.innerHTML = ""; logged = true; }
  const li = document.createElement("li");
  const time = document.createElement("time");
  const message = document.createElement("span");
  time.textContent = stamp();
  message.textContent = lane ? `${lane === "invite" ? "Connections" : "Enrichment"}: ${text}` : text;
  if (status) message.className = `s-${status}`;
  li.append(time, message);
  el.log.prepend(li);
  while (el.log.children.length > 80) el.log.lastElementChild.remove();
}

function progress(target, value, cap) {
  target.style.width = `${cap ? Math.min(100, (value / cap) * 100) : 0}%`;
}

function setRunning(lane) {
  activeLane = lane || null;
  const running = !!lane;
  el.warn.classList.toggle("show", running);
  el.dot.className = `dot${running ? " on" : ""}`;
  el.inviteStart.disabled = running || el.inviteStart.dataset.empty === "1";
  el.inviteDry.disabled = running || el.inviteDry.dataset.empty === "1";
  el.enrichStart.disabled = running || el.enrichStart.dataset.empty === "1";
  el.inviteStop.hidden = lane !== "invite";
  el.enrichStop.hidden = lane !== "enrich";
  el.inviteStatus.textContent = lane === "invite" ? "Running" : "Ready";
  el.enrichStatus.textContent = lane === "enrich" ? "Running" : "Ready";
  renderCampaigns();
}

function campaignButton(label, className, handler, disabled = false) {
  const button = document.createElement("button");
  button.className = className; button.textContent = label; button.disabled = disabled;
  button.addEventListener("click", handler);
  return button;
}

const STATE_LABEL = { ready: "Ready", running: "Running", paused: "Paused", stopped: "Stopped", completed: "Completed" };

function campaignLine(text) {
  const line = document.createElement("p"); line.className = "campaign-meta"; line.textContent = text;
  return line;
}

/**
 * One card per LinkedIn campaign, in product words only: people, progress, who
 * is being contacted right now, and just the controls that make sense in this
 * state. Every individual profile and outcome stays in Activity below.
 */
function renderCampaigns() {
  el.campaignList.innerHTML = "";
  if (!campaigns.length) {
    const empty = document.createElement("p"); empty.className = "empty";
    empty.textContent = "No LinkedIn campaigns yet. Create one with a LinkedIn step in the web app and enroll leads.";
    el.campaignList.append(empty); return;
  }
  for (const campaign of campaigns) {
    const mine = campaign.id === activeCampaignRunId;
    const executionState = mine ? "running" : campaign.executionState;
    const interrupted = !mine && executionState !== "running" && executionState !== "completed" && interruptedCampaignId === campaign.id;
    const card = document.createElement("article");
    card.className = `campaign-card${campaign.id === selectedCampaignId ? " selected" : ""}`;
    card.dataset.campaignId = campaign.id;

    const top = document.createElement("div"); top.className = "campaign-card-top";
    const name = document.createElement("h4"); name.textContent = campaign.name;
    const status = document.createElement("span"); status.className = "status";
    status.textContent = interrupted ? "Interrupted" : STATE_LABEL[executionState] || "Ready";
    top.append(name, status);

    const leads = `${campaign.leads} lead${campaign.leads === 1 ? "" : "s"}`;
    const progressLine = campaignLine(campaign.total ? `${leads} · ${campaign.completed} / ${campaign.total} completed` : leads);
    const bar = document.createElement("div"); bar.className = "campaign-progress";
    const fill = document.createElement("i"); fill.style.width = `${campaign.total ? Math.min(100, campaign.completed / campaign.total * 100) : 0}%`; bar.append(fill);

    const details = [];
    if (executionState === "running") {
      if (mine) details.push(campaignLine(`Current: ${currentWho || "starting…"}`));
      details.push(campaignLine(`Sent: ${campaign.sent} · Failed: ${campaign.failed} · Remaining: ${campaign.queued}`));
    } else if (interrupted) {
      details.push(campaignLine(`Interrupted with ${campaign.queued} still to go. Resume carries on with the people not yet contacted.`));
    } else if (campaign.missingMessages) {
      details.push(campaignLine(`${campaign.missingMessages} lead${campaign.missingMessages === 1 ? " needs" : "s need"} a message before this can start.`));
    } else if (executionState === "completed") {
      details.push(campaignLine(`Sent: ${campaign.sent} · Failed: ${campaign.failed}`));
    } else if (campaign.queued) {
      details.push(campaignLine(`Messages ready · ${campaign.queued} to send`));
    } else {
      details.push(campaignLine("Waiting for its next LinkedIn step."));
    }

    const foot = document.createElement("div"); foot.className = "campaign-card-foot";
    const actions = document.createElement("div"); actions.className = "actions";
    if (executionState === "running") {
      actions.append(campaignButton("Pause", "ghost small", () => controlCampaign(campaign.id, "pause")));
      actions.append(campaignButton("Stop", "danger small", () => controlCampaign(campaign.id, "stop")));
    } else if (executionState !== "completed") {
      if (campaign.missingMessages) actions.append(campaignButton("Fix messages in web app", "ghost small", () => switchView(true)));
      const cannotStart = !campaign.ready || !!campaign.missingMessages || !!activeLane;
      const resume = executionState === "paused" || interrupted;
      actions.append(campaignButton(resume ? "Resume" : "Start", "primary small", () => begin("invite", false, campaign.id), cannotStart));
      if (executionState !== "stopped") actions.append(campaignButton("Stop", "ghost small", () => controlCampaign(campaign.id, "stop"), !!activeLane));
    }
    foot.append(actions);
    card.append(top, progressLine, bar, ...details, foot);
    el.campaignList.append(card);
  }
}

async function loadCampaigns() {
  if (!window.ft.listCampaigns) return;
  const res = await window.ft.listCampaigns();
  if (!res.ok) {
    el.campaignConnection.textContent = "Unavailable"; el.campaignConnection.className = "status disconnected";
    el.campaignList.innerHTML = "";
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = res.error;
    el.campaignList.append(empty);
    return;
  }
  campaigns = res.campaigns || [];
  interruptedCampaignId = res.interruptedCampaignId || null;
  el.campaignConnection.textContent = res.connected ? "Desktop connected" : "Desktop checking in";
  el.campaignConnection.className = `status ${res.connected ? "connected" : ""}`;
  renderCampaigns();
}

async function controlCampaign(campaignId, action) {
  const res = await window.ft.controlCampaign({ campaignId, action });
  if (!res.ok) log(res.error, "failed", "invite");
  else {
    if (action === "pause" || action === "stop") activeCampaignRunId = null;
    log(`${action[0].toUpperCase()}${action.slice(1)} requested for campaign.`, null, "invite");
  }
  await loadCampaigns();
}

function emptyRow(list, message) {
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = message;
  list.appendChild(li);
}

function linkButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "link"; button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function saveNote(patch, errorTarget) {
  const res = await window.ft.setNote(patch);
  if (!res.ok) { (errorTarget || el.inviteNote).textContent = res.error; return false; }
  await loadInvites();
  return true;
}

function noteEditor(person, close) {
  const box = document.createElement("div"); box.className = "note-editor";
  const textarea = document.createElement("textarea"); textarea.rows = 3; textarea.value = person.note || "";
  textarea.setAttribute("aria-label", `Note for ${person.leadName || "this invitation"}`);
  const foot = document.createElement("div"); foot.className = "note-foot";
  const counter = document.createElement("span"); counter.className = "counter";
  const actions = document.createElement("div"); actions.className = "note-actions";
  const cancel = document.createElement("button"); cancel.className = "ghost small"; cancel.textContent = "Cancel";
  const save = document.createElement("button"); save.className = "primary small"; save.textContent = "Save";
  const error = document.createElement("p"); error.className = "err";
  const count = () => { const length = textarea.value.trim().length; counter.textContent = `${length} / ${NOTE_MAX}`; counter.classList.toggle("over", length > NOTE_MAX); save.disabled = !length || length > NOTE_MAX; };
  textarea.addEventListener("input", count);
  cancel.addEventListener("click", () => { box.remove(); close(); });
  save.addEventListener("click", async () => { save.disabled = true; if (!(await saveNote({ id: person.id, noteChoice: "yes", note: textarea.value.trim() }, error))) save.disabled = false; });
  actions.append(cancel, save); foot.append(counter, actions); box.append(textarea, foot, error); count();
  setTimeout(() => textarea.focus(), 0);
  return box;
}

function personRow(person, number, enrichment = false) {
  const li = document.createElement("li");
  const index = document.createElement("span"); index.className = "n"; index.textContent = String(number);
  const body = document.createElement("div"); body.className = "body";
  const name = document.createElement("div"); name.className = "name"; name.textContent = person.leadName || person.linkedinUrl;
  const meta = document.createElement("div"); meta.className = "meta";
  meta.textContent = enrichment ? [person.source, person.attempts ? `attempt ${person.attempts + 1}` : null].filter(Boolean).join(" · ") || person.linkedinUrl : [person.title, person.company].filter(Boolean).join(" · ") || person.linkedinUrl;
  body.append(name, meta);
  const right = document.createElement("div"); right.className = "right";
  const kind = document.createElement("span"); kind.className = "kind"; kind.textContent = enrichment ? "Lookup" : person.type === "message" ? "Message" : "Invite"; right.append(kind);

  if (!enrichment && person.type !== "message" && person.noteChoice && person.hold !== "no_credits") {
    const line = document.createElement("div"); line.className = "note-line";
    const text = document.createElement("span"); text.className = "note-text";
    const openEditor = () => { if (li.querySelector(".note-editor")) return; line.hidden = true; li.append(noteEditor(person, () => (line.hidden = false))); };
    if (person.hold === "needs_pick") {
      text.textContent = "Choose:"; line.append(text, linkButton("Add note", () => person.note ? saveNote({ id: person.id, noteChoice: "yes" }) : openEditor()), linkButton("No note", () => saveNote({ id: person.id, noteChoice: "no" })));
    } else {
      const on = person.noteChoice === "yes";
      text.textContent = person.hold === "no_notes_left" ? "Waits for tomorrow — no notes left" : on ? `“${person.note}”` : "Sends without a note";
      line.append(text, linkButton(on ? "Edit" : "Add one", openEditor));
      const toggleWrap = document.createElement("div"); toggleWrap.className = "note-switch"; toggleWrap.textContent = "Note";
      const toggle = document.createElement("button"); toggle.className = "switch"; toggle.type = "button"; toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-checked", String(on));
      toggle.addEventListener("click", async () => { if (!on && !person.note) return openEditor(); toggle.disabled = true; await saveNote({ id: person.id, noteChoice: on ? "no" : "yes" }); });
      toggleWrap.append(toggle); right.append(toggleWrap);
    }
    body.append(line);
  }
  if (!enrichment && person.hold === "no_credits") { const hold = document.createElement("div"); hold.className = "note-line"; hold.textContent = "Waiting for credits"; body.append(hold); }
  li.append(index, body, right);
  return li;
}

async function loadInvites() {
  const res = await window.ft.peekQueue();
  if (!res.ok) {
    emptyRow(el.inviteWho, res.error); el.inviteCount.textContent = "—"; el.inviteNote.textContent = ""; el.notesChip.hidden = true;
    el.inviteStart.dataset.empty = "1"; el.inviteDry.dataset.empty = "1"; setRunning(activeLane); return;
  }
  const people = res.people || [], held = res.held || [], all = [...people, ...held];
  if (res.usage) {
    inviteCap = res.usage.cap;
    el.cap.textContent = String(res.usage.cap);
    el.sent.textContent = String(res.usage.used);
    progress(el.inviteBar, res.usage.used, res.usage.cap);
  }
  el.inviteCount.textContent = String(all.length); el.inviteWho.innerHTML = "";
  if (!all.length) emptyRow(el.inviteWho, "Nothing queued. Add leads in the web app, then choose Connect on LinkedIn.");
  else all.forEach((person, index) => el.inviteWho.append(personRow(person, index + 1)));
  if (res.notes) { el.notesLeft.textContent = res.notes.exhaustedByLinkedIn ? "none left" : `${res.notes.left}/${res.notes.cap}`; el.notesChip.hidden = false; } else el.notesChip.hidden = true;
  const seconds = (res.pacing?.minDelaySec ?? 45) + (res.pacing?.maxDelaySec ?? 120);
  const minutes = Math.max(1, Math.round((people.length * seconds) / 2 / 60));
  el.inviteNote.textContent = people.length ? `${people.length} ready now · about ${minutes} min at the configured human pace.` : held.length ? "Queued invitations are waiting on a note choice or credits." : "";
  const empty = people.length === 0; el.inviteStart.dataset.empty = empty ? "1" : "0"; el.inviteDry.dataset.empty = empty ? "1" : "0";
  el.inviteStart.textContent = empty ? "Nothing ready to send" : `Send ${people.length} ${people.length === 1 ? "connection" : "connections"}`;
  setRunning(activeLane);
}

async function loadEnrichment() {
  const res = await window.ft.peekEnrichment();
  if (!res.ok) {
    const locked = /isn't included|upgrade to use it/i.test(res.error || "");
    emptyRow(el.enrichWho, locked ? "Profile enrichment is available on Grow and Scale." : res.error);
    el.enrichCount.textContent = "—";
    el.enrichNote.textContent = locked ? "Upgrade in the Followthroo web app, then reload this queue." : "";
    el.enrichStatus.textContent = locked ? "Upgrade required" : "Unavailable";
    el.enrichStart.textContent = locked ? "Upgrade in web app" : "Profile lookup unavailable";
    el.enrichStart.dataset.empty = "1"; setRunning(activeLane); return;
  }
  const people = res.people || [], daily = res.daily || { used: 0, cap: 0, remaining: 0 };
  el.enrichUsed.textContent = String(daily.used); el.enrichCap.textContent = String(daily.cap); progress(el.enrichBar, daily.used, daily.cap);
  el.enrichCount.textContent = String(res.queued ?? people.length); el.enrichWho.innerHTML = "";
  if (!people.length) emptyRow(el.enrichWho, "Nothing queued. Add a Profile enrichment step in a campaign or select leads in the web app.");
  else people.forEach((person, index) => el.enrichWho.append(personRow(person, index + 1, true)));
  el.enrichNote.textContent = people.length ? `Up to ${Math.min(30, people.length, daily.remaining)} will run in this batch. Only 1st-degree contact info is read.` : "";
  const empty = !people.length || daily.remaining <= 0; el.enrichStart.dataset.empty = empty ? "1" : "0";
  el.enrichStart.textContent = daily.remaining <= 0 ? "Daily lookup limit reached" : empty ? "Nothing ready to look up" : `Look up ${Math.min(30, people.length, daily.remaining)} profiles`;
  setRunning(activeLane);
}

async function loadQueues() { await Promise.all([loadInvites(), loadEnrichment(), loadCampaigns()]); }
async function refreshAuth() { const { signedIn } = await window.ft.authStatus(); el.signin.classList.toggle("show", !signedIn); return signedIn; }

async function switchView(showWeb) {
  const res = await window.ft.togglePanel(showWeb);
  document.body.classList.toggle("collapsed", res.collapsed);
}
el.collapse.addEventListener("click", () => switchView(true)); el.webSwitch.addEventListener("click", () => switchView(true)); el.reopen.addEventListener("click", () => switchView(false));

el.signinBtn.addEventListener("click", async () => { el.signinBtn.disabled = true; el.signinBtn.textContent = "Opening browser..."; await window.ft.signIn(); setTimeout(() => { el.signinBtn.disabled = false; el.signinBtn.textContent = "Sign in"; }, 4000); });
el.save.addEventListener("click", async () => { el.settingsErr.textContent = ""; const res = await window.ft.saveSettings({ apiBase: el.apiBase.value, token: el.token.value }); if (!res.ok) { el.settingsErr.textContent = res.error; return; } el.apiBase.value = res.settings.apiBase; log("Settings saved."); await loadQueues(); });

async function begin(lane, dryRun = false, campaignId = null) {
  ended[lane] = false; el.settingsErr.textContent = ""; activeCampaignRunId = campaignId; setRunning(lane);
  const now = lane === "invite" ? el.inviteNow : el.enrichNow;
  now.textContent = dryRun ? "Test run — no invitation will be sent." : "Starting Chrome...";
  log(dryRun ? "Test run started — nothing will be sent." : "Run started.", null, lane);
  const res = await window.ft.start({ mode: lane, dryRun, campaignId });
  if (!res.ok) { activeCampaignRunId = null; setRunning(null); now.textContent = res.error; el.dot.className = "dot err"; log(res.error, "failed", lane); }
}
el.inviteStart.addEventListener("click", () => begin("invite")); el.inviteDry.addEventListener("click", () => begin("invite", true)); el.enrichStart.addEventListener("click", () => begin("enrich"));
async function stop(lane) { const button = lane === "invite" ? el.inviteStop : el.enrichStop; const now = lane === "invite" ? el.inviteNow : el.enrichNow; button.disabled = true; now.textContent = "Stopping after this profile..."; await window.ft.stop(); button.disabled = false; }
el.inviteStop.addEventListener("click", () => stop("invite")); el.enrichStop.addEventListener("click", () => stop("enrich"));
el.reload.addEventListener("click", async () => { el.reload.disabled = true; await loadQueues(); setTimeout(() => (el.reload.disabled = false), 400); });

window.ft.onEvent((event) => {
  const lane = event.lane || activeLane || "invite";
  const now = lane === "invite" ? el.inviteNow : el.enrichNow;
  switch (event.type) {
    case "status": now.textContent = event.message; break;
    case "needs-signin": now.textContent = event.message; log(event.message, null, lane); break;
    case "action-start":
      now.textContent = `Opening ${event.who}...`;
      if (activeCampaignRunId) { currentWho = event.who; renderCampaigns(); }
      break;
    case "action-done":
      if (event.sent !== undefined) { el.sent.textContent = String(event.sent); progress(el.inviteBar, event.sent, inviteCap); }
      log(`${event.who} — ${event.result}`, event.status, lane);
      loadCampaigns();
      break;
    case "waiting": if (event.sent !== undefined) { el.sent.textContent = String(event.sent); progress(el.inviteBar, event.sent, inviteCap); } break;
    case "tick": now.textContent = `Waiting ${event.remaining}s before the next invitation.`; break;
    case "enrich-start": now.textContent = `Looking up ${event.who}...`; break;
    case "enrich-debug": now.textContent = event.message; log(`${event.who} — ${event.message}`, event.status, lane); break;
    case "enrich-done": now.textContent = event.result || `${event.who} complete.`; log(`${event.who} — ${event.result}`, event.status, lane); break;
    case "fatal": now.textContent = event.message; el.dot.className = "dot err"; ended[lane] = true; log(event.message, "failed", lane); break;
    case "done": {
      // "will retry" is its own count, not a failure: a lead Followthroo is
      // going to try again is still one lead in flight, and counting it beside
      // the settled failures made one retried lookup read as two dead ones.
      const parts = lane === "invite"
        ? [`${event.sent || 0} sent`, `${event.failed || 0} failed`, `${event.skipped || 0} skipped`]
        : [
            `${event.done || 0} found`,
            `${event.failed || 0} failed`,
            ...(event.retrying ? [`${event.retrying} will retry`] : []),
            `${event.skipped || 0} skipped`,
          ];
      log(`Finished — ${parts.join(", ")}.`, event.sent || event.done ? "sent" : null, lane);
      if (event.stoppedBecause) { now.textContent = event.stoppedBecause; ended[lane] = true; }
      break;
    }
    case "paired": log("Paired with your Followthroo account."); load(); break;
    case "signed-in": log("Signed in."); refreshAuth(); load(); break;
    case "signin-failed": el.dot.className = "dot err"; log(event.message, "failed"); break;
    case "idle": if (!ended[lane]) now.textContent = "Done."; ended[lane] = false; activeCampaignRunId = null; currentWho = null; setRunning(null); loadQueues(); break;
  }
});

if (window.ft.onCampaignSelect) {
  window.ft.onCampaignSelect(({ campaignId }) => {
    selectedCampaignId = campaignId;
    renderCampaigns();
    const card = el.campaignList.querySelector(`[data-campaign-id="${CSS.escape(campaignId)}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

window.ft.onUpdate((event) => {
  if (event.type === "available" || event.type === "downloading" || event.type === "ready") el.update.classList.add("show"); else el.update.classList.remove("show");
  if (event.type === "available") el.updateText.textContent = `Downloading v${event.version}...`;
  if (event.type === "downloading") el.updateText.textContent = `Downloading update — ${event.percent}%`;
  if (event.type === "ready") { el.updateText.textContent = `v${event.version} is ready.`; el.updateBtn.hidden = false; }
});
el.updateBtn.addEventListener("click", async () => { el.updateBtn.disabled = true; const res = await window.ft.installUpdate(); if (!res.ok) { el.updateBtn.disabled = false; el.updateText.textContent = res.error; } });

async function load() {
  const settings = await window.ft.getSettings();
  if (settings.version) el.version.textContent = `v${settings.version}`;
  // A brief loading fallback only. loadInvites immediately replaces this with
  // the server's shared queue usage, so another computer cannot over-send.
  inviteCap = settings.maxPerDay; el.cap.textContent = "…"; el.sent.textContent = "…"; progress(el.inviteBar, 0, inviteCap);
  el.apiBase.value = settings.apiBase; el.token.value = settings.token; setRunning(settings.running ? settings.runningMode || "invite" : null);
  if (!settings.token) { el.settings.open = true; el.inviteNow.textContent = "Sign in or paste a pairing token to begin."; }
  await refreshAuth(); await loadQueues();
}

load();
setInterval(() => { if (!document.hidden) loadCampaigns(); }, 15_000);
