#!/usr/bin/env node
// Read-only check for plan.md §33.1 — confirms which of the 5 flagged items are
// actually reachable by the anon role. Makes NO changes to the database.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/check-331-anon-grants.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()

  console.log('--- Table RLS status ---')
  const tables = await client.query(`
    select relname, relrowsecurity
    from pg_class
    where relname in ('leave_payouts', 'geocode_cache')
  `)
  console.table(tables.rows)

  console.log('\n--- Does anon have a direct table grant, if RLS is off? ---')
  const tableGrants = await client.query(`
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_name in ('leave_payouts', 'geocode_cache')
      and grantee in ('anon', 'authenticated', 'public')
    order by table_name, grantee, privilege_type
  `)
  console.table(tableGrants.rows)

  console.log('\n--- Function EXECUTE privilege for anon ---')
  const fns = await client.query(`
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('anon', p.oid, 'execute') as anon_can_call
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('road_distance_km', 'travel_summary_for_employee', 'travel_refine_distances_core')
    order by p.proname
  `)
  console.table(fns.rows)

  await client.end()
}

main().catch((err) => {
  console.error('Check failed:', err.message)
  process.exit(1)
})
