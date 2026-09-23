#!/usr/bin/env node
// One-off: apply supabase/migrations/0056_travel_google_routes_option.sql.
// Adds Google Routes as a preferred, optional provider (falls back to OpenRouteService,
// then to the straight-line estimate) — see the migration's own header for why. Safe to
// apply before a Google key exists: with no google_maps_api_key set, the dispatcher
// falls straight through to the existing ORS path, unchanged.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0056-travel-google-routes-option.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0056_travel_google_routes_option.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'fetch_directory', 'is_valid_admin_token',
  'is_valid_employee_token', 'log_audit', 'haversine_m', 'travel_refine_distances_core',
  'admin_refine_travel_distances', 'employee_refine_own_travel_distances',
  'travel_summary_for_employee', 'admin_settle_travel_period', 'admin_set_ors_api_key',
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
    // Baseline: today's known-good ORS result for Puneet's real leg, BEFORE this
    // migration — the dispatcher must return the exact same number after, since no
    // Google key exists yet and this leg is already refined (road_leg_km set).
    const { rows: before } = await client.query(`select road_distance_km(28.638972, 77.364963, 28.551055, 77.321045) as km`)
    console.log('road_distance_km() before migration (should be the known-good ORS result):', before[0].km)

    const beforeHashes = await fnHashes(client, MUST_BE_UNCHANGED)
    await client.query(sql)
    console.log('Migration 0056 applied.')

    const afterHashes = await fnHashes(client, MUST_BE_UNCHANGED)
    let changed = false
    for (const name of MUST_BE_UNCHANGED) {
      if (beforeHashes[name] !== afterHashes[name]) {
        console.error(`  !! ${name} changed unexpectedly`)
        changed = true
      }
    }
    if (changed) { process.exit(1) }
    console.log('Confirmed:', MUST_BE_UNCHANGED.length, 'unrelated functions byte-identical to before.')

    const { rows: after } = await client.query(`select road_distance_km(28.638972, 77.364963, 28.551055, 77.321045) as km`)
    console.log('road_distance_km() after migration (should be identical — no Google key yet):', after[0].km)
    if (String(before[0].km) !== String(after[0].km)) {
      console.error('  !! Result changed with no Google key configured — regression, investigate before trusting this migration.')
      process.exit(1)
    }
    console.log('Confirmed: zero behavioural change with no Google key set.')

    // §33.1 discipline: verify the new internal helpers are NOT anon-callable, and the
    // new admin wrapper IS.
    const { rows: grants } = await client.query(`
      select proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_call
      from pg_proc p where proname in ('road_distance_km_google', 'road_distance_km_ors', 'admin_set_google_maps_api_key', 'admin_get_routing_key_status')
    `)
    console.table(grants)

    const { rows: keyStatus } = await client.query(`select google_maps_api_key is not null as has_google_key from travel_routing_settings where id = 1`)
    console.log('Google key configured yet:', keyStatus[0].has_google_key, '(expected: false, until admin sets one)')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
