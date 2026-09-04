#!/usr/bin/env node
// One-off: apply supabase/migrations/0036_per_employee_std_hours.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13 / memory hrms-employee-session-expiry-fix-2026-08-20). Adds
// employees.std_hours_override, extends fetch_directory/employees_directory/
// admin_create_employee/admin_update_employee/run_comp_off_accrual to carry it, and
// sets the override to 8 for emp_num 1113 (Archana) and 1154 (Vivek Singh) — the data
// update is guarded and idempotent (checks an audit_logs marker, and aborts instead of
// writing if it doesn't find exactly those 2 employees), so this script is safe to
// re-run.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0036-per-employee-std-hours.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0036_per_employee_std_hours.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    const { rows } = await client.query(
      `select emp_num, name, std_hours_override from employees where emp_num in ('1113', '1154') order by emp_num`
    )
    console.log('Applied 0036_per_employee_std_hours.sql.')
    console.log('Override now set to:', rows)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
