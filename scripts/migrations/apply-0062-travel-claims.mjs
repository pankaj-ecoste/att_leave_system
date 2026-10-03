#!/usr/bin/env node
// One-off: apply supabase/migrations/0062_travel_claims.sql (plan.md §46).
// Then a rolled-back dry run: submits a claim for a real employee through a throwaway
// employee session, shows the result, and ROLLS BACK — nothing committed.
//
// Usage: DATABASE_URL="postgresql://..." node scripts/migrations/apply-0062-travel-claims.mjs [employee name fragment]

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
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0062_travel_claims.sql'), 'utf8')
const nameLike = `%${process.argv[2] || 'himanshu%bansal'}%`

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'fetch_directory', 'is_valid_admin_token',
  'is_valid_employee_token', 'log_audit', 'haversine_m', 'travel_summary_for_employee',
  'admin_settle_travel_period', 'employee_add_travel_visit', 'road_distance_km',
]

async function fnHashes(client, names) {
  const { rows } = await client.query(`
    select p.proname, md5(pg_get_functiondef(p.oid)) as hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`, [names])
  return Object.fromEntries(rows.map(r => [r.proname, r.hash]))
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await fnHashes(client, MUST_BE_UNCHANGED)
  await client.query(sql)
  console.log('Migration 0062 applied.')

  const after = await fnHashes(client, MUST_BE_UNCHANGED)
  const changed = MUST_BE_UNCHANGED.filter(n => before[n] !== after[n])
  if (changed.length) { console.error('!! unexpected changes:', changed); process.exit(1) }
  console.log(`Confirmed: ${MUST_BE_UNCHANGED.length} unrelated functions byte-identical.`)

  await client.query('BEGIN')
  try {
    const { rows: emp } = await client.query(`select id, name from employees where name ilike $1 limit 1`, [nameLike])
    if (!emp.length) throw new Error('No employee matched for dry run')
    const token = '22222222-2222-2222-2222-222222222222'
    await client.query(`insert into employee_sessions (token, emp_id, expires_at) values ($1, $2, now() + interval '5 minutes')`, [token, emp[0].id])
    const { rows: t } = await client.query(`select * from travel_claim_totals($1, (now() at time zone 'Asia/Kolkata')::date)`, [emp[0].id])
    console.log(`Dry run — ${emp[0].name} unclaimed totals up to today:`, t[0])
    const { rows: c } = await client.query(`select * from employee_submit_travel_claim($1, $2, (now() at time zone 'Asia/Kolkata')::date)`, [token, emp[0].id])
    console.log('Dry run — submit would create:', c[0])
  } catch (e) {
    console.log('Dry run stopped with:', e.message)
  } finally {
    await client.query('ROLLBACK')
    console.log('Dry run rolled back — nothing committed.')
  }
} finally {
  await client.end()
}
