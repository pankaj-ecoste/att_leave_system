#!/usr/bin/env node
// One-off: apply supabase/migrations/0040_casual_leave_same_day.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13 / memory hrms-employee-session-expiry-fix-2026-08-20). Redefines
// employee_apply_leave to allow Casual Leave (full-day and half-day) to be applied
// today, not just one day in advance (plan.md §22) — same treatment Partial Leave
// already got in 0031. Every other rule in the function is untouched.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0040-casual-leave-same-day.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0040_casual_leave_same_day.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // Verify what's actually live before touching it — plan.md §17/§13 both flagged
    // prod function bodies silently drifting from the migration files in this repo.
    const before = await client.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'employee_apply_leave'
    `)
    const beforeHasCasualExemption = (before.rows[0]?.def || '').includes("'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Casual Leave'")
    console.log('Live employee_apply_leave already has the Casual Leave exemption:', beforeHasCasualExemption)

    await client.query(sql)
    console.log('Applied 0040_casual_leave_same_day.sql.')

    const after = await client.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'employee_apply_leave'
    `)
    const afterHasCasualExemption = (after.rows[0]?.def || '').includes("'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Casual Leave'")
    console.log('Live employee_apply_leave now has the Casual Leave exemption:', afterHasCasualExemption)
    if (!afterHasCasualExemption) {
      console.error('FATAL: migration ran but the exemption is not present in the live function body.')
      process.exit(1)
    }

    const priv = await client.query(`
      select has_function_privilege('anon', 'public.employee_apply_leave(uuid,uuid,jsonb)', 'execute') as anon_can_call
    `)
    console.log('anon execute privilege:', priv.rows[0])
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
