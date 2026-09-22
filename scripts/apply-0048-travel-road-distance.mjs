#!/usr/bin/env node
// One-off: apply supabase/migrations/0048_travel_road_distance.sql.
// Safe to apply with no ORS key configured yet — every new column is nullable and every
// coalesce() falls through to the exact haversine behaviour that already existed, so
// this changes nothing observable until admin actually sets a key via the new Travel
// tab UI. See plan.md §28 follow-up (2026-09-22).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0048-travel-road-distance.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0048_travel_road_distance.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'fetch_directory', 'is_valid_admin_token',
  'is_valid_employee_token', 'log_audit', 'haversine_m', 'reverse_geocode',
  'employee_add_travel_visit', 'admin_override_travel_visit_distance', 'admin_settle_travel_period',
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
    console.log('Migration 0048 applied.')

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

    // Sanity: with no key configured, travel_summary_for_employee must behave exactly
    // as it did pre-0048 for existing data — this is the real regression check.
    const { rows: puneet } = await client.query(`select id from employees where name ilike '%puneet%sharma%'`)
    if (puneet.length) {
      const { rows: summary } = await client.query(`select * from travel_summary_for_employee($1)`, [puneet[0].id])
      console.log('Puneet Sharma summary (should be unchanged, ~19.73km, no key set yet):', summary[0])
    }

    const { rows: keyStatus } = await client.query(`select ors_api_key is not null as has_key from travel_routing_settings where id = 1`)
    console.log('ORS key configured:', keyStatus[0]?.has_key)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
