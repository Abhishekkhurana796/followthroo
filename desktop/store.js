/**
 * Settings on disk: which Followthroo the app talks to, and the pairing token
 * that identifies this member.
 *
 * Deliberately small and plain JSON in the OS's per-user app-data folder. The
 * pairing token is a bearer for this member's queue — it can enqueue and report
 * actions, and nothing else. The LinkedIn session itself is never here; it
 * lives in the browser profile folder beside this file, which is the point of
 * running on the desktop at all.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  apiBase: "https://app.followthroo.com",
  token: "",
};

function file(userDataPath) {
  return path.join(userDataPath, "settings.json");
}

function read(userDataPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(file(userDataPath), "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(userDataPath, patch) {
  const next = { ...read(userDataPath), ...patch };
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(file(userDataPath), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * The app URL, normalised.
 *
 * The marketing site and the product are different hosts, and typing the
 * marketing one is the single most common setup mistake — it has no API behind
 * it, so every poll 404s and the app looks broken rather than misconfigured.
 */
function normaliseApiBase(input) {
  const value = String(input || "").trim().replace(/\/+$/, "");
  if (!value) return { ok: false, error: "Enter your Followthroo address." };
  if (!/^https?:\/\//i.test(value)) return { ok: false, error: "Address should start with https://" };
  if (/^https?:\/\/(www\.)?followthroo\.com/i.test(value)) {
    return { ok: false, error: 'Use https://app.followthroo.com — the product lives there, not on the marketing site.' };
  }
  return { ok: true, value };
}

/**
 * How often a run may look at the connections list to spot accepted invitations.
 *
 * One page view at the start of a run, at most this often. The point is to
 * notice acceptances, not to add browsing that LinkedIn could count against the
 * account — so it is rationed like everything else the app does.
 */
const CONNECTIONS_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Is it time to look at the connections list again? */
function connectionsCheckDue(userDataPath) {
  const last = Date.parse(read(userDataPath).connectionsCheckedAt || "");
  return Number.isNaN(last) || Date.now() - last >= CONNECTIONS_CHECK_EVERY_MS;
}

/** Record that the connections list was just read. */
function markConnectionsChecked(userDataPath) {
  return write(userDataPath, { connectionsCheckedAt: new Date().toISOString() });
}

module.exports = {
  read, write, normaliseApiBase, DEFAULTS,
  connectionsCheckDue, markConnectionsChecked, CONNECTIONS_CHECK_EVERY_MS,
};
