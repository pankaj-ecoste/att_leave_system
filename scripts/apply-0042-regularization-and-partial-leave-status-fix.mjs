#!/usr/bin/env node
// One-off: apply supabase/migrations/0042_regularization_and_partial_leave_status_fix.sql
// directly (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13). Redefines manager_decide_regularization, admin_decide_regularization
// (stdHours-based status instead of a hardcoded 'Present', merges with any existing
// punch instead of blindly overwriting it, and actually updates status on conflict —
// it used to stay frozen) and apply_leave_approval_effects (Partial Leave 1hr/2hr no
// longer forced to 'Leave' — computed from actual hours + the leave's credited hours,
// same as calcStatus). See plan.md §24.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0042-regularization-and-partial-leave-status-fix.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0042_regularization_and_partial_leave_status_fix.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const FUNCTIONS = ['manager_decide_regularization', 'admin_decide_regularization', 'apply_leave_approval_effects']
const MARKER = 'v_std_hours' // present in the fixed body of all three, absent from the old one

async function getDefs(client) {
  const defs = {}
  for (const fn of FUNCTIONS) {
    const { rows } = await client.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1
    `, [fn])
    defs[fn] = rows[0]?.def || ''
  }
  return defs
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // Verify what's actually live before touching it — plan.md §17/§13/§24 all flagged
    // prod function bodies silently drifting from the migration files in this repo.
    const before = await getDefs(client)
    for (const fn of FUNCTIONS) {
      console.log(`Live ${fn} already has the fix:`, before[fn].includes(MARKER))
    }

    await client.query(sql)
    console.log('Applied 0042_regularization_and_partial_leave_status_fix.sql.')

    const after = await getDefs(client)
    let allGood = true
    for (const fn of FUNCTIONS) {
      const has = after[fn].includes(MARKER)
      console.log(`Live ${fn} now has the fix:`, has)
      if (!has) allGood = false
    }
    if (!allGood) {
      console.error('FATAL: migration ran but at least one function is missing the expected fix.')
      process.exit(1)
    }

    const priv = await client.query(`
      select
        has_function_privilege('anon', 'public.manager_decide_regularization(uuid,uuid,uuid,text)', 'execute') as manager_reg,
        has_function_privilege('anon', 'public.admin_decide_regularization(uuid,uuid,text)', 'execute') as admin_reg
    `)
    console.log('anon execute privileges:', priv.rows[0])
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
