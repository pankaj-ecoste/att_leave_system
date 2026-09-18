#!/usr/bin/env node
// One-off: apply supabase/migrations/0044_travel_allowance.sql directly (apply-
// migrations.mjs full-replay is broken at migration 0010 on prod — see plan.md §13).
// Purely additive — new tables (travel_visits, travel_settlements, ta_settings), a new
// storage bucket, a new employees.ta_rate_tier column, and brand-new functions only. No
// existing function is redefined. See plan.md §28.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0044-travel-allowance.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0044_travel_allowance.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const NEW_FUNCTIONS = [
  'employee_add_travel_visit', 'employee_get_travel_journey', 'employee_get_travel_summary',
  'employee_get_travel_settlements', 'manager_get_team_travel_summary', 'manager_get_team_travel_journey',
  'admin_get_travel_overview', 'admin_get_employee_travel_journey', 'admin_get_travel_settlements',
  'admin_set_ta_rate_tier', 'admin_get_ta_settings', 'admin_update_ta_settings',
  'admin_override_travel_visit_distance', 'admin_settle_travel_period', 'travel_summary_for_employee',
]

// Every existing function this migration must NOT touch, spot-checked before and after
// by hash — if any of these differ, something is badly wrong and we stop before
// treating the run as successful.
const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'admin_create_employee', 'fetch_directory',
  'is_valid_admin_token', 'is_valid_employee_token', 'log_audit', 'haversine_m',
]

async function fnHashes(client, names) {
  const { rows } = await client.query(`
    select p.proname, md5(pg_get_functiondef(p.oid)) as hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
  `, [names])
  return Object.fromEntries(rows.map(r => [r.proname, r.hash]))
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const before = await fnHashes(client, MUST_BE_UNCHANGED)
    console.log('Untouched-function hashes captured before applying:', Object.keys(before).length, 'of', MUST_BE_UNCHANGED.length, 'found')

    await client.query(sql)
    console.log('Migration 0044 applied.')

    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    let changed = false
    for (const name of MUST_BE_UNCHANGED) {
      if (before[name] !== after[name]) {
        console.error(`  !! ${name} changed — this must NOT happen (before=${before[name]}, after=${after[name]})`)
        changed = true
      }
    }
    if (changed) {
      console.error('Aborting verification: an existing function changed. Investigate immediately.')
      process.exit(1)
    }
    console.log('Confirmed: all', MUST_BE_UNCHANGED.length, 'pre-existing functions checked are byte-identical to before.')

    const { rows: newFns } = await client.query(`
      select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname = any($1::text[])
    `, [NEW_FUNCTIONS])
    console.log(`New functions live: ${newFns.length}/${NEW_FUNCTIONS.length}`)
    const missing = NEW_FUNCTIONS.filter(f => !newFns.some(r => r.proname === f))
    if (missing.length) console.error('  Missing:', missing.join(', '))

    const { rows: tables } = await client.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('travel_visits', 'travel_settlements', 'ta_settings')
    `)
    console.log('New tables live:', tables.map(t => t.table_name).join(', '))

    const { rows: col } = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'employees' and column_name = 'ta_rate_tier'
    `)
    console.log('employees.ta_rate_tier column present:', col.length === 1)

    const { rows: bucket } = await client.query(`select id, public, file_size_limit from storage.buckets where id = 'travel-selfies'`)
    console.log('travel-selfies bucket:', bucket[0] || 'MISSING')

    const { rows: settings } = await client.query(`select * from ta_settings where id = 1`)
    console.log('ta_settings seed row:', settings[0])
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
