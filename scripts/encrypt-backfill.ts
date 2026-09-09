/**
 * Encrypt existing plaintext credentials in place, and re-encrypt under a new
 * key during rotation.
 *
 * The Prisma extension in lib/db-encryption.ts encrypts on write and tolerates
 * legacy plaintext on read, so the app keeps working before this runs. This is
 * what actually clears the plaintext out.
 *
 *   npx tsx --env-file=.env.local scripts/encrypt-backfill.ts
 *   npx tsx --env-file=.env.local scripts/encrypt-backfill.ts --rotate
 *   npx tsx --env-file=.env.local scripts/encrypt-backfill.ts --dry-run
 *
 * (`--env-file` is needed because ENCRYPTION_KEYS lives in .env.local, which
 * Next.js loads for the app but a standalone script does not. Prisma picks up
 * DATABASE_URL from .env on its own.)
 *
 * Default mode touches only rows that are still plaintext, so it is safe to run
 * repeatedly. `--rotate` re-encrypts every row under the active key — run it
 * after adding a new key and BEFORE retiring the old one, or rows sealed with
 * the retired key become unreadable.
 *
 * ---- ORDER OF OPERATIONS (this is not optional) ----
 * This rewrites credentials the DEPLOYED app has to read back. Run it out of
 * order and sending breaks silently: the live app reads ciphertext, hands it to
 * the mail provider as a password, and every login is rejected.
 *
 *   1. Set ENCRYPTION_KEYS in the host environment (Vercel -> Settings -> Env).
 *      Use a DIFFERENT key per environment; the local one is for local only.
 *   2. Deploy the code containing lib/db-encryption.ts, and confirm it is live.
 *   3. Only then run this against that environment's database.
 *
 * Steps 1-2 leave the app able to read BOTH plaintext and ciphertext, which is
 * what makes step 3 a non-event. Real runs require --yes.
 */
import { prisma } from "../lib/db";
import { ENCRYPTED_COLUMNS } from "../lib/db-encryption";
import { encryptionConfigured, isEncrypted } from "../lib/crypto";

/** Prisma delegate name → actual table name (better-auth's models are @@map'd). */
const TABLES: Record<string, string> = {
  sendingAccount: "SendingAccount",
  account: "account",
};

const rotate = process.argv.includes("--rotate");
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--yes");

type Delegate = { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };

async function main() {
  if (!encryptionConfigured()) {
    console.error(
      "ENCRYPTION_KEYS is not set.\n" +
        "  Generate:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
        "  Then add:  ENCRYPTION_KEYS=v1:<that value>   (in .env.local, and in your host's env)\n" +
        "  And run this with:  npx tsx --env-file=.env.local scripts/encrypt-backfill.ts"
    );
    process.exit(1);
  }

  if (!dryRun && !confirmed) {
    const host = (() => {
      try {
        return new URL(process.env.DATABASE_URL ?? "").hostname;
      } catch {
        return "(unknown)";
      }
    })();
    console.error(
      `Refusing to rewrite credentials in ${host} without --yes.

Before running this for real, confirm ALL of these:
  1. ENCRYPTION_KEYS is set in that environment's own host config (not just .env.local)
  2. The deploy containing lib/db-encryption.ts is LIVE there
  3. You are pointed at the database you think you are (host above)

Steps 1-2 are what let the live app read plaintext AND ciphertext, which is what
makes this a non-event. Skipping them is the outage: the app reads ciphertext,
hands it to the mail provider as a password, and every send fails.

Preview with --dry-run, then run:
  npx tsx --env-file=.env.local scripts/encrypt-backfill.ts --yes`
    );
    process.exit(1);
  }

  console.log(rotate ? "Mode: ROTATE (re-encrypt every row)" : "Mode: BACKFILL (plaintext rows only)");
  if (dryRun) console.log("Dry run — nothing will be written.\n");

  let totalRows = 0;
  let totalFields = 0;

  for (const [model, columns] of Object.entries(ENCRYPTED_COLUMNS)) {
    const table = TABLES[model];
    if (!table) throw new Error(`No table name mapped for model "${model}" — add it to TABLES above.`);

    // Read raw so we can see what is physically stored: going through the client
    // would decrypt, and plaintext and ciphertext would look identical.
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const rows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(
      `SELECT "id", ${quoted} FROM "${table}"`
    );

    let touchedRows = 0;
    let touchedFields = 0;

    for (const row of rows) {
      const data: Record<string, string> = {};
      for (const column of columns) {
        const stored = row[column];
        if (stored == null || stored === "") continue;
        const encrypted = isEncrypted(stored);
        // Backfill: plaintext only. Rotate: everything (the extension re-seals
        // under the active key on write, and decrypts the old key on read).
        if (encrypted && !rotate) continue;
        data[column] = stored;
        touchedFields++;
      }
      if (Object.keys(data).length === 0) continue;
      touchedRows++;

      if (!dryRun) {
        const delegate = (prisma as unknown as Record<string, Delegate>)[model];
        // Round-trip through the client: read decrypts (or passes plaintext
        // through), write re-encrypts under the active key.
        const current = (await delegate.findUnique({ where: { id: row.id } })) as Record<string, string> | null;
        if (!current) continue;
        const plain: Record<string, string> = {};
        for (const column of Object.keys(data)) plain[column] = current[column];
        await delegate.update({ where: { id: row.id }, data: plain });
      }
    }

    console.log(`  ${table.padEnd(16)} ${rows.length} rows scanned, ${touchedRows} updated, ${touchedFields} fields`);
    totalRows += touchedRows;
    totalFields += touchedFields;
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${totalFields} field(s) across ${totalRows} row(s).`);

  if (!dryRun && totalFields > 0) {
    // Prove it, rather than assume it.
    let leftover = 0;
    for (const [model, columns] of Object.entries(ENCRYPTED_COLUMNS)) {
      const quoted = columns.map((c) => `"${c}"`).join(", ");
      const rows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(
        `SELECT ${quoted} FROM "${TABLES[model]}"`
      );
      for (const row of rows) {
        for (const column of columns) {
          const v = row[column];
          if (v != null && v !== "" && !isEncrypted(v)) leftover++;
        }
      }
    }
    console.log(leftover === 0 ? "Verified: no plaintext left in any encrypted column." : `WARNING: ${leftover} plaintext value(s) remain.`);
    if (leftover > 0) process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
