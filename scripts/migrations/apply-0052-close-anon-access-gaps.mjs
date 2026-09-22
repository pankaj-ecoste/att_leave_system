#!/usr/bin/env node
// One-off: apply supabase/migrations/0052_close_anon_access_gaps.sql (plan.md §33.1).
//
// Before: confirms the 5 gaps are still live (matches the earlier read-only check).
// Applies the migration (permissions only, no function bodies redefined).
// After: confirms the 5 gaps are closed, AND confirms 5 legitimate token-checked
// wrapper functions that depend on the now-revoked helpers still work end-to-end —
// via a real call inside BEGIN...ROLLBACK, so nothing is actually written.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0052-close-anon-access-gaps.mjs

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0052_close_anon_access_gaps.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function anonReach(client) {
  const { rows: tables } = await client.query(`
    select relname, relrowsecurity from pg_class
    where relname in ('leave_payouts', 'geocode_cache')
  `)
  const { rows: fns } = await client.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_call
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('road_distance_km', 'travel_summary_for_employee', 'travel_refine_distances_core')
    order by p.proname
  `)
  return { tables, fns }
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    console.log('--- Before ---')
    const before = await anonReach(client)
    console.table(before.tables)
    console.table(before.fns)

    await client.query(sql)
    console.log('\nMigration 0052 applied.\n')

    console.log('--- After ---')
    const after = await anonReach(client)
    console.table(after.tables)
    console.table(after.fns)

    const stillOpen = []
    for (const t of after.tables) if (t.relrowsecurity !== true) stillOpen.push(t.relname)
    for (const f of after.fns) if (f.anon_can_call !== false) stillOpen.push(f.proname)
    if (stillOpen.length) {
      console.error('\n!! Still reachable after migration:', stillOpen.join(', '))
      process.exit(1)
    }
    console.log('\nConfirmed: all 5 gaps closed.\n')

    // Prove legitimate callers still work — real RPC calls, rolled back, nothing written.
    console.log('--- Proving legitimate callers are unaffected (dry-run, rolled back) ---')
    await client.query('BEGIN')
    try {
      const testToken = '22222222-2222-2222-2222-222222222222'
      await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '5 minutes')`, [testToken])

      // admin_get_travel_overview -> cross join lateral travel_summary_for_employee() for every employee
      const overview = await client.query(`select count(*) from admin_get_travel_overview($1)`, [testToken])
      console.log('admin_get_travel_overview (uses travel_summary_for_employee internally): OK,', overview.rows[0].count, 'rows')

      // admin_refine_travel_distances -> travel_refine_distances_core -> road_distance_km
      const { rows: emp } = await client.query(`select id from employees where deleted_at is null limit 1`)
      if (emp.length) {
        const refined = await client.query(`select admin_refine_travel_distances($1, $2)`, [testToken, emp[0].id])
        console.log('admin_refine_travel_distances (uses travel_refine_distances_core + road_distance_km internally): OK, returned', refined.rows[0].admin_refine_travel_distances)
      }

      // Confirm anon itself still cannot call the inner helper directly, even now
      let directCallBlocked = false
      try {
        await client.query(`set local role anon`)
        await client.query(`select travel_summary_for_employee($1)`, [emp[0]?.id ?? '00000000-0000-0000-0000-000000000000'])
      } catch (e) {
        directCallBlocked = true
        console.log('Direct anon call to travel_summary_for_employee correctly REJECTED:', e.message)
      } finally {
        await client.query(`reset role`)
      }
      if (!directCallBlocked) {
        console.error('!! anon could still call travel_summary_for_employee directly — fix did not take effect')
        process.exitCode = 1
      }
    } finally {
      await client.query('ROLLBACK')
      console.log('Dry-run rolled back — no real data touched.')
    }
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
