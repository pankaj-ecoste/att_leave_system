#!/usr/bin/env node
// One-off: apply supabase/migrations/0039_login_device_binding.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13 / memory hrms-employee-session-expiry-fix-2026-08-20). Redefines
// employee_login to bind on first login and deny a mismatched device outright
// (plan.md §19) — reuses the punch_device_id/punch_device_bound_at columns 0038
// already added, no schema change here. Also deletes every row from
// employee_sessions (HR's explicit choice, plan.md §19 #7) — this logs out every
// currently-logged-in employee, so the very next thing each of them does is a fresh
// PIN entry that goes through the new device check. Admin sessions are untouched.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0039-login-device-binding.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0039_login_device_binding.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Applied 0039_login_device_binding.sql.')

    const fns = await client.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'employee_login'
      order by args
    `)
    console.log('employee_login signatures now live:', fns.rows)

    const priv = await client.query(`
      select has_function_privilege('anon', 'public.employee_login(uuid,text,text)', 'execute') as anon_can_call
    `)
    console.log('anon execute privilege:', priv.rows[0])

    const sessions = await client.query('select count(*)::int as remaining from employee_sessions')
    console.log('employee_sessions remaining (should be 0):', sessions.rows[0].remaining)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
