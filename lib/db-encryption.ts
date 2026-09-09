/**
 * Transparent column encryption, applied as a Prisma client extension.
 *
 * Why an extension rather than encrypting at each call site: better-auth's
 * prismaAdapter writes `Account.accessToken` / `refreshToken` / `idToken`
 * through this same client and there is no hook to wrap. Anything that reaches
 * the database goes through here, so a new call site cannot forget.
 *
 * ---- On the AAD ----
 * The additional authenticated data is `model:column`, deliberately without the
 * row's organizationId. Binding to a tenant sounds stronger, but a Prisma
 * `update({ where: { id }, data: { pass } })` does not carry organizationId, so
 * writes and reads would disagree on the AAD and the row would stop opening.
 * Column binding is what survives every code path: a ciphertext still cannot be
 * moved from `refreshToken` into `pass` and decrypt. Tenant isolation is
 * enforced where it actually belongs — the `organizationId` scoping in
 * lib/tenant.ts — not in the cipher.
 *
 * Encryption is idempotent: an already-enveloped value is passed through
 * untouched, so re-running the backfill or writing a value read straight back
 * from the database cannot double-encrypt it.
 */
import { Prisma } from "@prisma/client";
import { decryptField, encryptField, fieldAad, isEncrypted } from "./crypto";

/**
 * Model (as Prisma's lowercased delegate name) → columns to encrypt.
 *
 * Only columns that are never filtered on belong here. A column that appears in
 * a `where` needs a blind index instead (see lib/crypto.ts) — GCM ciphertext is
 * non-deterministic, so equality against it can never match.
 */
export const ENCRYPTED_COLUMNS: Record<string, readonly string[]> = {
  sendingAccount: ["pass", "refreshToken", "dkimPrivateKey"],
  account: ["accessToken", "refreshToken", "idToken"],
  // A member's own LinkedIn OAuth tokens. Never filtered on — the row is found
  // by (organizationId, userId), so no blind index is needed.
  linkedInAccount: ["liAccessToken", "liRefreshToken"],
};

type Row = Record<string, unknown>;

const aadFor = (model: string, column: string) => fieldAad(model, column);

/** Encrypt one value, tolerating Prisma's `{ set: value }` update form. */
function encryptValue(model: string, column: string, value: unknown): unknown {
  if (typeof value === "string") {
    return isEncrypted(value) ? value : encryptField(value, aadFor(model, column));
  }
  if (value && typeof value === "object" && "set" in (value as Row)) {
    const inner = (value as Row).set;
    if (typeof inner === "string") {
      return { set: isEncrypted(inner) ? inner : encryptField(inner, aadFor(model, column)) };
    }
  }
  // null / undefined / anything else Prisma accepts passes through unchanged.
  return value;
}

function encryptData(model: string, columns: readonly string[], data: unknown): void {
  if (!data) return;
  if (Array.isArray(data)) {
    for (const row of data) encryptData(model, columns, row);
    return;
  }
  if (typeof data !== "object") return;
  const row = data as Row;
  for (const column of columns) {
    if (row[column] === undefined) continue;
    row[column] = encryptValue(model, column, row[column]);
  }
}

/**
 * Filtering on an encrypted column silently returns nothing, which is far worse
 * than an error — it looks like "no such account" rather than "this query can
 * never work". Refuse it loudly.
 */
function assertNotFiltered(model: string, columns: readonly string[], where: unknown): void {
  if (!where || typeof where !== "object") return;
  for (const column of columns) {
    if ((where as Row)[column] !== undefined) {
      throw new Error(
        `Cannot filter ${model} on encrypted column "${column}" — ciphertext is non-deterministic. ` +
          `Add a blind-index column (see lib/crypto.ts blindIndex) if this needs to be searchable.`
      );
    }
  }
}

function decryptRow(model: string, columns: readonly string[], row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const r = row as Row;
  for (const column of columns) {
    const value = r[column];
    // Absent when the query used a `select` that omitted it — nothing to do.
    if (typeof value !== "string") continue;
    r[column] = decryptField(value, aadFor(model, column));
  }
  return row;
}

function decryptResult(model: string, columns: readonly string[], result: unknown): unknown {
  if (Array.isArray(result)) {
    for (const row of result) decryptRow(model, columns, row);
    return result;
  }
  return decryptRow(model, columns, result);
}

/**
 * One interceptor per model: encrypt on the way in, decrypt on the way out,
 * and refuse a query that tries to filter on ciphertext.
 */
function interceptorFor(model: keyof typeof ENCRYPTED_COLUMNS) {
  const columns = ENCRYPTED_COLUMNS[model];
  return async function $allOperations({
    args,
    query: run,
  }: {
    args: unknown;
    query: (args: never) => Promise<unknown>;
  }) {
    if (args && typeof args === "object") {
      const a = args as Row;
      assertNotFiltered(model, columns, a.where);
      if (a.data !== undefined) encryptData(model, columns, a.data);
      // upsert carries two payloads rather than one.
      if (a.create !== undefined) encryptData(model, columns, a.create);
      if (a.update !== undefined) encryptData(model, columns, a.update);
    }
    return decryptResult(model, columns, await run(args as never));
  };
}

/**
 * The extension itself. Model keys are spelled out rather than looped, because
 * Prisma types `query` per-model and a computed record widens to `never`.
 * Exported separately from lib/db.ts so a backfill script can build its own
 * client with identical behaviour.
 */
export function encryptionExtension() {
  return Prisma.defineExtension({
    name: "field-encryption",
    query: {
      sendingAccount: { $allOperations: interceptorFor("sendingAccount") },
      account: { $allOperations: interceptorFor("account") },
    },
  });
}
