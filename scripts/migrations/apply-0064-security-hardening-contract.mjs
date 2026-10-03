#!/usr/bin/env node
// One-off: apply supabase/migrations/0064_security_hardening_contract.sql (phase 2 of 2).
//
// ONLY run this after the phase-1 client (login list from fetch_login_directory; full
// directory and admin email after sign-in) is live in production. Running it earlier
// would break browsers still on the previous version.
//
// Applies inside one transaction and COMMITS only if every check passes. Checks that
// the public exposure is gone, the signed-in path still works, and the public settings
// still load. All behaviour checks run in a savepoint and are rolled back.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0064-security-hardening-contract.mjs

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

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0064_security_hardening_contract.sql'), 'utf8')
const problems = []
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) problems.push(msg) }

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    console.log('Migration 0064 applied inside one transaction (commits only if every check passes).\n')

    const can = async (rel, priv) => (await client.query(`select has_table_privilege('anon', $1, $2) ok`, [rel, priv])).rows[0].ok
    const fnCan = async (sig) => (await client.query(`select has_function_privilege('anon', $1::regprocedure, 'execute') ok`, [sig])).rows[0].ok

    check(!(await fnCan('public.fetch_directory()')), 'old public full directory fetch_directory() is closed to anon')
    check(!(await can('public.employees_directory', 'SELECT')), 'old employees_directory view is closed to anon')
    const { rows: cols } = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='app_settings_public'`)
    const colNames = cols.map(c => c.column_name).sort().join(',')
    check(colNames === 'birthday_message,std_hours', `public settings expose only std_hours and birthday_message (got: ${colNames})`)
    check(await can('public.app_settings_public', 'SELECT'), 'public settings still readable by anon (login needs std_hours)')
    check(await fnCan('public.fetch_login_directory()'), 'login list still callable by anon')

    console.log('\n--- Behaviour checks (savepoint, rolled back) ---')
    await client.query('SAVEPOINT b')
    try {
      const { rows: [emp] } = await client.query(`select id from employees where active and deleted_at is null order by name limit 1`)
      await client.query(`insert into employee_sessions (token, emp_id) values ('99999999-9999-9999-9999-999999999999', $1)`, [emp.id])
      const full = await client.query(`select count(*)::int n from employee_fetch_directory('99999999-9999-9999-9999-999999999999', $1)`, [emp.id])
      check(full.rows[0].n > 0, 'signed-in full directory still works')
      const mail = await client.query(`select employee_fetch_admin_email('99999999-9999-9999-9999-999999999999', $1) v`, [emp.id])
      check('v' in mail.rows[0], 'signed-in admin email still works')
    } catch (e) {
      check(false, `behaviour check error: ${e.message}`)
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT b')
    }

    if (problems.length) {
      await client.query('ROLLBACK')
      console.error(`\n${problems.length} check(s) failed — ROLLED BACK, production unchanged.`)
      process.exit(1)
    }
    await client.query('COMMIT')
    console.log('\nAll checks passed — migration COMMITTED.')
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
