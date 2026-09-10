/**
 * Take the public Supabase roles off the application's tables.
 *
 * Supabase publishes the `public` schema through its REST Data API to two roles:
 * `anon` (anyone holding the project's anon key) and `authenticated`. Row-level
 * security is on for every table with no policies, so as of 2026-09-10 that API
 * returns nothing. But both roles still held every privilege on every table, and
 * the schema's default privileges handed them the same on any table created later
 * — which `prisma db push` creates with row-level security OFF. One new table would
 * have been readable and writable by anyone with the anon key.
 *
 * Followthroo never uses those roles: it connects as the table owner, which
 * bypasses row-level security and keeps every privilege. So this removes the
 * roles' access — now and by default for future tables — and turns row-level
 * security on for any table that lacks it.
 *
 *   npx tsx --env-file=.env scripts/lockdown-supabase-roles.ts          # report only
 *   npx tsx --env-file=.env scripts/lockdown-supabase-roles.ts --yes    # apply
 *
 * Idempotent. Reversible with GRANT, though nothing in the app should need it.
 * Run the report after any schema change that adds a table.
 */
import { prisma } from "../lib/db";

const apply = process.argv.includes("--yes");
const ROLES = "anon, authenticated";

async function state() {
  const grants = await prisma.$queryRawUnsafe<{ grantee: string; tables: number }[]>(
    `select grantee, count(distinct table_name)::int as tables
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
      group by grantee order by grantee`,
  );
  const withoutRls = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `select c.relname as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`,
  );
  const defaults = await prisma.$queryRawUnsafe<{ acl: string }[]>(
    `select defaclacl::text as acl
       from pg_default_acl
      where defaclnamespace = 'public'::regnamespace and pg_get_userbyid(defaclrole) = current_user`,
  );
  const policies = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `select count(*)::int as n from pg_policies where schemaname = 'public'`,
  );
  return {
    publicRoleGrants: grants,
    tablesWithoutRls: withoutRls.map((r) => r.t),
    futureTablesGrantPublicRoles: defaults.some((d) => /\b(anon|authenticated)=/.test(d.acl)),
    policies: policies[0]?.n ?? 0,
  };
}

async function main() {
  const before = await state();
  console.log("Before:", JSON.stringify(before, null, 2));
  if (before.policies > 0) {
    console.log(`Note: ${before.policies} row-level security policies exist. This script does not change policies — review them.`);
  }
  if (!apply) {
    console.log("Report only — nothing changed. Re-run with --yes to apply.");
    return;
  }

  for (const t of before.tablesWithoutRls) {
    await prisma.$executeRawUnsafe(`alter table public."${t.replace(/"/g, '""')}" enable row level security`);
  }
  for (const statement of [
    `revoke all on all tables in schema public from ${ROLES}`,
    `revoke all on all sequences in schema public from ${ROLES}`,
    `revoke all on all functions in schema public from ${ROLES}`,
    // For the connecting role, which is the one that creates tables here.
    `alter default privileges in schema public revoke all on tables from ${ROLES}`,
    `alter default privileges in schema public revoke all on sequences from ${ROLES}`,
    `alter default privileges in schema public revoke all on functions from ${ROLES}`,
  ]) {
    await prisma.$executeRawUnsafe(statement);
  }

  const after = await state();
  console.log("After:", JSON.stringify(after, null, 2));
  const locked = after.publicRoleGrants.length === 0 && after.tablesWithoutRls.length === 0 && !after.futureTablesGrantPublicRoles;
  console.log(locked ? "Locked down." : "Something is still open — see above.");
  if (!locked) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
