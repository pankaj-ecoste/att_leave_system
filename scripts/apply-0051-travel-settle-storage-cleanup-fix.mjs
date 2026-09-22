#!/usr/bin/env node
// One-off: apply supabase/migrations/0051_travel_settle_storage_cleanup_fix.sql.
// Fixes the real root cause of "Settle & Pay isn't working" — Supabase disallows plain
// SQL deletes on storage.objects, so admin_settle_travel_period has failed on every
// call since it first shipped (0 rows in travel_settlements, confirmed). See the
// migration's own header for the full story and the dry-run that proved it.
//
// After applying, re-runs the same dry-run (BEGIN ... ROLLBACK, nothing committed) to
// confirm it now actually succeeds for Himanshu Bansal before calling this fixed.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0051-travel-settle-storage-cleanup-fix.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0051_travel_settle_storage_cleanup_fix.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'fetch_directory', 'is_valid_admin_token',
  'is_valid_employee_token', 'log_audit', 'haversine_m', 'road_distance_km',
  'employee_add_travel_visit', 'travel_summary_for_employee', 'travel_refine_distances_core',
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
    console.log('Migration 0051 applied.')

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

    // Dry-run proof: BEGIN, call the real function with a throwaway admin session,
    // ROLLBACK everything — nothing committed, but we see whether it WOULD succeed now.
    await client.query('BEGIN')
    try {
      const { rows: emp } = await client.query(`select id from employees where name ilike '%himanshu%bansal%'`)
      if (emp.length) {
        const testToken = '11111111-1111-1111-1111-111111111111'
        await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '5 minutes')`, [testToken])
        const { rows } = await client.query(`select * from admin_settle_travel_period($1, $2)`, [testToken, emp[0].id])
        console.log('Dry-run settle SUCCEEDED (would pay):', rows[0])
      } else {
        console.log('Himanshu Bansal not found — skipping dry-run proof.')
      }
    } catch (e) {
      console.error('Dry-run settle STILL FAILS:', e.message)
      process.exitCode = 1
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
