#!/usr/bin/env node
// One-off: apply supabase/migrations/0050_travel_road_distance_accept_header_fix.sql.
// Fixes the Accept header road_distance_km() sends — confirmed live against real ORS
// before this migration existed (see the migration's own header comment).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0050-ors-accept-header-fix.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0050_travel_road_distance_accept_header_fix.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'fetch_directory', 'is_valid_admin_token',
  'is_valid_employee_token', 'log_audit', 'haversine_m', 'travel_refine_distances_core',
  'admin_refine_travel_distances', 'employee_refine_own_travel_distances', 'travel_summary_for_employee',
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
    console.log('Migration 0050 applied.')

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

    // Live end-to-end check: refine Puneet Sharma's real visit and confirm the total
    // actually changed from the pure-haversine 19.73km.
    const { rows: emp } = await client.query(`select id from employees where name ilike '%puneet%sharma%'`)
    if (emp.length) {
      const { rows: refined } = await client.query(`select travel_refine_distances_core($1) as count`, [emp[0].id])
      console.log('Visits refined:', refined[0].count)
      const { rows: summary } = await client.query(`select * from travel_summary_for_employee($1)`, [emp[0].id])
      console.log('Puneet Sharma updated summary (was 19.73km pure-haversine):', summary[0])
    }
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
