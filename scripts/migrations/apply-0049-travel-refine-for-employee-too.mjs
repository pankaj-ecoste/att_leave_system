#!/usr/bin/env node
// One-off: apply supabase/migrations/0049_travel_refine_for_employee_too.sql.
// Adds employee_refine_own_travel_distances so the employee's own screen and admin's
// review screen converge on the same refined number instead of one lagging the other.
// See plan.md §31 follow-up.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0049-travel-refine-for-employee-too.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0049_travel_refine_for_employee_too.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'fetch_directory', 'is_valid_admin_token',
  'is_valid_employee_token', 'log_audit', 'haversine_m', 'road_distance_km',
  'employee_add_travel_visit', 'admin_settle_travel_period', 'travel_summary_for_employee',
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
    console.log('Migration 0049 applied.')

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
      where n.nspname = 'public' and proname in ('travel_refine_distances_core', 'employee_refine_own_travel_distances')
    `)
    console.log('New functions live:', rows.map(r => r.proname))
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
