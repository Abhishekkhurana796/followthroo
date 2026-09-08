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
  /** Reset each calendar day; see `dayKey` below. */
  sentToday: 0,
  sentOn: "",
};

function file(userDataPath) {
  return path.join(userDataPath, "settings.json");
}

function dayKey() {
  return new Date().toDateString();
}

function read(userDataPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(file(userDataPath), "utf8"));
    const merged = { ...DEFAULTS, ...raw };
    // A count from yesterday must not eat into today's allowance.
    if (merged.sentOn !== dayKey()) {
      merged.sentToday = 0;
      merged.sentOn = dayKey();
    }
    return merged;
  } catch {
    return { ...DEFAULTS, sentOn: dayKey() };
  }
}

function write(userDataPath, patch) {
  const next = { ...read(userDataPath), ...patch };
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(file(userDataPath), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Record a send against today's tally. */
function countSend(userDataPath) {
  const cur = read(userDataPath);
  return write(userDataPath, { sentToday: cur.sentToday + 1, sentOn: dayKey() });
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

module.exports = { read, write, countSend, normaliseApiBase, DEFAULTS };
