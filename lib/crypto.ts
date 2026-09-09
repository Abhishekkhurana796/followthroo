/**
 * Field-level encryption for data at rest.
 *
 * Three primitives, deliberately distinct:
 *  - `encryptField` / `decryptField` — AES-256-GCM for secrets we must read back
 *    (SMTP passwords, OAuth refresh tokens, DKIM private keys, tenant channel
 *    credentials).
 *  - `blindIndex` — a keyed HMAC for a value we must still look up by equality
 *    after encrypting it. GCM is non-deterministic by design, so an encrypted
 *    column can never appear in a `where`; the blind index is the searchable
 *    shadow that can.
 *  - `hashToken` / `tokenMatches` — one-way, for bearer tokens we only ever
 *    verify and never display back. Encryption would be the wrong tool there: a
 *    token that can be decrypted is a token that can leak.
 *
 * Ciphertext format: `<keyId>.<iv>.<tag>.<ciphertext>`, every part base64url
 * (which contains no `.`, so the split is unambiguous). The leading key id is
 * what makes rotation a redeploy rather than an outage — old rows keep naming
 * the key that can still open them.
 *
 * Anything without that envelope is legacy plaintext and is returned unchanged,
 * so existing rows keep working and migrate on their next write.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard 96-bit nonce
const KEY_BYTES = 32;
const KEY_ID_RE = /^v[0-9]+$/;

const GENERATE_HINT =
  'Generate one with:  node -e "console.log(String.fromCharCode(118,49,58)+require(\'crypto\').randomBytes(32).toString(\'base64\'))"';

type Keyring = { keys: Map<string, Buffer>; activeId: string | null };

let cachedRing: Keyring | null = null;

function decodeKey(id: string, b64: string): Buffer {
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEYS: key "${id}" is ${buf.length} bytes, need ${KEY_BYTES} (base64 of 32 random bytes)`);
  }
  return buf;
}

/**
 * Parse `ENCRYPTION_KEYS="v1:<base64>,v2:<base64>"`. A lone `ENCRYPTION_KEY` is
 * accepted as `v1` so a single-key setup needs no ceremony.
 *
 * Read lazily rather than at import: nothing in this app may throw at module
 * load (see lib/env.ts), and scripts set env after importing.
 */
function keyring(): Keyring {
  if (cachedRing) return cachedRing;

  const keys = new Map<string, Buffer>();
  const raw = process.env.ENCRYPTION_KEYS?.trim();
  const solo = process.env.ENCRYPTION_KEY?.trim();

  for (const entry of (raw ?? "").split(",")) {
    const part = entry.trim();
    if (!part) continue;
    const idx = part.indexOf(":");
    if (idx < 1) throw new Error(`ENCRYPTION_KEYS: malformed entry "${part}" — expected "v1:<base64 32-byte key>"`);
    const id = part.slice(0, idx).trim();
    if (!KEY_ID_RE.test(id)) throw new Error(`ENCRYPTION_KEYS: bad key id "${id}" — expected v1, v2, …`);
    keys.set(id, decodeKey(id, part.slice(idx + 1).trim()));
  }
  if (solo && !keys.has("v1")) keys.set("v1", decodeKey("v1", solo));

  const wanted = process.env.ENCRYPTION_ACTIVE_KEY?.trim();
  if (wanted && !keys.has(wanted)) {
    throw new Error(`ENCRYPTION_ACTIVE_KEY="${wanted}" is not present in ENCRYPTION_KEYS`);
  }
  // Default to the highest-numbered key, so adding v2 makes it active on its own.
  const activeId = wanted ?? [...keys.keys()].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0] ?? null;

  cachedRing = { keys, activeId };
  return cachedRing;
}

/** Test seam — call after mutating process.env in a script or test. */
export function resetKeyringCache(): void {
  cachedRing = null;
}

/** True when at least one key is configured, so callers can report status without throwing. */
export function encryptionConfigured(): boolean {
  try {
    return keyring().activeId !== null;
  } catch {
    return false;
  }
}

const b64u = (b: Buffer) => b.toString("base64url");

/** Does this value already carry our ciphertext envelope? */
export function isEncrypted(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && KEY_ID_RE.test(parts[0]);
}

/**
 * `aad` binds the ciphertext to where it lives — build it with `fieldAad`.
 * Decryption under a different AAD fails, so a row cannot be copied between
 * tenants or columns and still open.
 */
export function fieldAad(model: string, column: string, organizationId?: string | null): string {
  return `${model}:${column}:${organizationId ?? "-"}`;
}

export function encryptField(plain: string, aad: string): string {
  const { keys, activeId } = keyring();
  if (!activeId) {
    // Fail closed. Silently writing a credential in plaintext is the exact
    // outcome this module exists to prevent, so refuse and say how to fix it.
    throw new Error(`ENCRYPTION_KEYS is not set — refusing to store a secret in plaintext. ${GENERATE_HINT}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keys.get(activeId)!, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${activeId}.${b64u(iv)}.${b64u(cipher.getAuthTag())}.${b64u(ct)}`;
}

/**
 * Unenveloped input is legacy plaintext and comes back untouched — that is what
 * lets existing rows keep working before the backfill runs. A *known* envelope
 * that fails to open throws instead, because returning raw ciphertext would
 * silently hand the caller garbage it would then use as a password.
 */
export function decryptField(stored: string, aad: string): string {
  if (!isEncrypted(stored)) return stored;
  const [keyId, ivB64, tagB64, ctB64] = stored.split(".");
  const key = keyring().keys.get(keyId);
  if (!key) {
    throw new Error(
      `Ciphertext names key "${keyId}", which is not in ENCRYPTION_KEYS — do not retire a key until every row is re-encrypted`
    );
  }

  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Node's own message here is "Unsupported state or unable to authenticate
    // data", which names neither the key nor the row and sends people looking at
    // their auth config. The key id matched, so what actually happened is one of
    // two things, and both are worth saying out loud: the key material behind
    // this id is not the one that encrypted the row (the usual cause — a local
    // .env pointed at someone else's database, with its own "v1"), or the row
    // moved between columns or tenants, which the AAD deliberately prevents.
    throw new Error(
      `Could not decrypt ${aad} with key "${keyId}". The id matches, so the key material differs from the one ` +
        `that encrypted this row — check that ENCRYPTION_KEYS belongs to the database in DATABASE_URL. ` +
        `(A local key called "${keyId}" is not the same key as a production one with the same name.)`
    );
  }
}

export function encryptNullable(plain: string | null | undefined, aad: string): string | null {
  return plain == null || plain === "" ? null : encryptField(plain, aad);
}

export function decryptNullable(stored: string | null | undefined, aad: string): string | null {
  return stored == null || stored === "" ? null : decryptField(stored, aad);
}

/**
 * Deterministic keyed digest, so an encrypted column stays searchable by exact
 * match. Keyed rather than a bare hash so a stolen database cannot be
 * brute-forced against a dictionary of phone numbers.
 *
 * Shares the app secret with lib/ingest-key.ts: rotating it invalidates every
 * blind index, which is why it is deliberately not the encryption key.
 */
export function blindIndex(value: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.APP_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET (or APP_SECRET) must be set to compute a blind index");
  return createHmac("sha256", secret).update(`bi:${value}`).digest("hex");
}

/** One-way digest for a bearer token we only ever verify, never display back. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
