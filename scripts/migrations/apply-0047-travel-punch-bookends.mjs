#!/usr/bin/env node
// One-off: apply supabase/migrations/0047_travel_punch_bookends.sql.
// Purely additive — one new function (manager_get_team_travel_attendance), nothing
// else touched. See plan.md §28 follow-up.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0047-travel-punch-bookends.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0047_travel_punch_bookends.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'admin_get_attendance', 'fetch_directory',
  'is_valid_admin_token', 'is_valid_employee_token', 'log_audit', 'haversine_m',
  'employee_add_travel_visit', 'travel_summary_for_employee', 'admin_settle_travel_period',
  'manager_get_team_travel_journey', 'manager_get_team_travel_summary',
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

    await client.query(sql)
    console.log('Migration 0047 applied.')

    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    let changed = false
    for (const name of MUST_BE_UNCHANGED) {
      if (before[name] !== after[name]) {
        console.error(`  !! ${name} changed unexpectedly`)
        changed = true
      }
    }
    if (changed) { process.exit(1) }
    console.log('Confirmed:', MUST_BE_UNCHANGED.length, 'unrelated functions byte-identical to before.')

    const { rows } = await client.query(`
      select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname = 'manager_get_team_travel_attendance'
    `)
    console.log('manager_get_team_travel_attendance present:', rows.length === 1)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
