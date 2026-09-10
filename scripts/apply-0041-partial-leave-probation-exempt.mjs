#!/usr/bin/env node
// One-off: apply supabase/migrations/0041_partial_leave_probation_exempt.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13 / memory hrms-employee-session-expiry-fix-2026-08-20). Redefines
// employee_apply_leave so Partial Leave - 1 Hour / 2 Hours is exempt from the
// Probation/Notice-Period "only 1 leave per year" cap — same treatment LOP/Work From
// Home/On Duty already get (plan.md §23). Every other rule in the function is untouched.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0041-partial-leave-probation-exempt.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0041_partial_leave_probation_exempt.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const EXEMPTION_MARKER = "'LOP', 'Work From Home', 'On Duty', 'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours'"

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
    const beforeHasExemption = (before.rows[0]?.def || '').includes(EXEMPTION_MARKER)
    console.log('Live employee_apply_leave already has the Partial Leave probation exemption:', beforeHasExemption)

    await client.query(sql)
    console.log('Applied 0041_partial_leave_probation_exempt.sql.')

    const after = await client.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'employee_apply_leave'
    `)
    const afterDef = after.rows[0]?.def || ''
    const afterHasExemption = afterDef.split(EXEMPTION_MARKER).length - 1 === 2
    console.log('Live employee_apply_leave now has the Partial Leave probation exemption in both places:', afterHasExemption)
    if (!afterHasExemption) {
      console.error('FATAL: migration ran but the exemption is not present in both places in the live function body.')
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
