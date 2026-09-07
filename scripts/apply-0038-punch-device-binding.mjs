#!/usr/bin/env node
// One-off: apply supabase/migrations/0038_punch_device_binding.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13 / memory hrms-employee-session-expiry-fix-2026-08-20). Adds
// employees.punch_device_id/punch_device_bound_at, redefines employee_punch to bind
// on first use and reject a mismatch, and adds admin_reset_punch_device(). Purely
// additive/replace — no data changes to existing rows.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0038-punch-device-binding.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0038_punch_device_binding.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Applied 0038_punch_device_binding.sql.')

    const cols = await client.query(`
      select column_name from information_schema.columns
      where table_name = 'employees' and column_name in ('punch_device_id', 'punch_device_bound_at')
    `)
    console.log('employees columns present:', cols.rows.map(r => r.column_name))

    const fns = await client.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('employee_punch', 'admin_reset_punch_device')
      order by p.proname
    `)
    console.log('functions now live:', fns.rows)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
