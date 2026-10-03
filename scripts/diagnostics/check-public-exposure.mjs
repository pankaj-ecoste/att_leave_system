#!/usr/bin/env node
// Read-only check: what can someone holding only the app's public key reach?
// Runs inside a READ ONLY transaction and changes nothing. Re-run after any migration
// or any new function/view to catch new exposure early (plan.md §46).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/diagnostics/check-public-exposure.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

// A function is fine if its body checks a login token. Otherwise it must be on this list:
// a login/logout, a public list the login screen needs, or a deliberate public helper.
// Anything else anon can call is reported as unexpected.
const EXPECTED_ANON_FUNCTIONS = new Set([
  'admin_login', 'admin_logout', 'employee_login', 'employee_logout',
  'fetch_login_directory', 'get_effective_std_hours', 'reverse_geocode',
  'travel_photo_is_orphaned',
  'current_fy', 'haversine_m', 'nearest_active_site', 'safe_numeric',
  'is_valid_admin_token', 'is_valid_employee_token',
])
// Views and tables the public key may read on purpose.
const EXPECTED_ANON_READ = new Set(['app_settings_public', 'holidays', 'sites'])

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query('BEGIN READ ONLY')
  let unexpected = 0
  try {
    const { rows: fns } = await client.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) args, (p.prosrc ~* 'is_valid_(admin|employee)_token') as token_checked
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      order by 1, 2`)
    console.log(`Functions callable with ONLY the public key: ${fns.length}`)
    for (const f of fns) {
      if (!f.token_checked && !EXPECTED_ANON_FUNCTIONS.has(f.proname)) {
        unexpected++
        console.log(`  UNEXPECTED  ${f.proname}(${f.args})`)
      }
    }

    // A table is readable by the public key only if the grant exists AND row-level
    // protection is either off or has an open policy for anon/public. Views run with the
    // owner's rights, so any view the key can select from counts as exposed.
    const { rows: rels } = await client.query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and has_table_privilege('anon', c.oid, 'SELECT')
        and (c.relkind = 'v' or not c.relrowsecurity or exists (
              select 1 from pg_policy p
              where p.polrelid = c.oid and p.polpermissive and p.polcmd in ('r', '*')
                and (0 = any(p.polroles) or (select oid from pg_roles where rolname = 'anon') = any(p.polroles))))
      order by 1`)
    console.log(`\nTables and views the public key can READ (after row-level protection): ${rels.length}`)
    for (const r of rels) {
      if (!EXPECTED_ANON_READ.has(r.relname)) {
        unexpected++
        console.log(`  UNEXPECTED  ${r.relname}`)
      }
    }

    const { rows: [t] } = await client.query(`
      select count(*)::int n from pg_tables t where t.schemaname = 'public' and (
        has_table_privilege('anon', 'public.'||t.tablename, 'TRUNCATE') or has_table_privilege('anon', 'public.'||t.tablename, 'REFERENCES') or has_table_privilege('anon', 'public.'||t.tablename, 'TRIGGER'))`)
    if (t.n > 0) { unexpected++; console.log(`\n  UNEXPECTED  ${t.n} table(s) grant TRUNCATE/REFERENCES/TRIGGER to the public key`) }

    console.log(unexpected === 0 ? '\nNo unexpected exposure.' : `\n${unexpected} unexpected exposure(s) — investigate before the next release.`)
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
  process.exit(unexpected === 0 ? 0 : 1)
}

main().catch(err => { console.error(err.message); process.exit(2) })
