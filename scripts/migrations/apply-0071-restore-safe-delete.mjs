#!/usr/bin/env node
// plan.md §57 — apply supabase/migrations/0071_restore_safe_delete.sql.
//
// DEFAULT = DRY RUN: the migration and a walk-through run inside one transaction that is ROLLED BACK (the test
// employee and everything attached to it disappear with it). Pass --apply to commit only the migration, after the
// same checks pass again.
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0071-restore-safe-delete.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0071_restore_safe_delete.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['admin_create_employee', 'admin_update_employee', 'admin_toggle_employee_status', 'admin_set_employment_status', 'fetch_directory', 'employee_login', 'employee_get_my_team', 'is_valid_admin_token', 'log_audit']
const snap = async c => Object.fromEntries((await c.query(
  `select p.proname k, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [MUST_BE_UNCHANGED])).rows.map(r => [r.k, r.h]))

let failures = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }

async function runChecks(c, before) {
  const after = await snap(c)
  for (const k of Object.keys(before)) ok(before[k] === after[k], `unchanged: ${k}`)
  for (const f of ['admin_delete_employee', 'admin_get_employees']) {
    const { rows: [v] } = await c.query(`select count(*)::int n, bool_or(has_function_privilege('anon', p.oid, 'execute')) anon from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [f])
    ok(v.n === 1 && v.anon === true, `exactly one ${f}, anon may call it (token-checked)`, `${v.n} version(s)`)
  }

  const token = crypto.randomUUID()
  await c.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '1 hour')`, [token])
  const liveBefore = (await c.query(`select count(*)::int n from employees where deleted_at is null`)).rows[0].n
  const listBefore = (await c.query(`select count(*)::int n from admin_get_employees($1)`, [token])).rows[0].n
  ok(listBefore === liveBefore, 'admin list shows exactly the live employees', `${listBefore} of ${liveBefore}`)

  const { rows: [e] } = await c.query(`select * from admin_create_employee($1, $2::jsonb)`, [token, JSON.stringify({ name: 'ZZ Delete Test', pin: '4821', company: 'Asma Traexim Pvt Ltd' })])
  await c.query(`insert into attendance (emp_id, date, in_time) values ($1, current_date, '09:00:00')`, [e.id])
  ok((await c.query(`select count(*)::int n from admin_get_employees($1) where id = $2`, [token, e.id])).rows[0].n === 1, 'new employee shows in the admin list')

  const { rows: [d] } = await c.query(`select admin_delete_employee($1, $2) r`, [token, e.id])
  ok(d.r === true, 'delete returns true')
  const { rows: [row] } = await c.query(`select deleted_at, active from employees where id = $1`, [e.id])
  ok(row && row.deleted_at !== null && row.active === false, 'the employee ROW still exists, marked deleted and inactive')
  ok((await c.query(`select count(*)::int n from attendance where emp_id = $1`, [e.id])).rows[0].n === 1, 'their attendance history is KEPT')
  ok((await c.query(`select count(*)::int n from leave_balances where emp_id = $1`, [e.id])).rows[0].n > 0, 'their leave balances are KEPT')
  ok((await c.query(`select count(*)::int n from admin_get_employees($1) where id = $2`, [token, e.id])).rows[0].n === 0, 'the admin list no longer shows them')
  ok((await c.query(`select count(*)::int n from fetch_directory() where id = $1`, [e.id])).rows[0].n === 0, 'the login/directory list does not show them')
  ok((await c.query(`select count(*)::int n from admin_get_employees($1)`, [token])).rows[0].n === liveBefore, 'admin list is back to the live count', String(liveBefore))
  const { rows: [aud] } = await c.query(`select count(*)::int n from audit_logs where action = 'EMPLOYEE_DELETE' and detail = 'ZZ Delete Test'`)
  ok(aud.n === 1, 'the delete is written to the audit log')
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  await client.query('begin')
  await client.query(sql)
  await runChecks(client, before)
  if (APPLY && failures === 0) { await client.query('rollback'); await client.query('begin'); await client.query(sql); await client.query('commit'); console.log('\nCOMMITTED migration 0071.') }
  else { await client.query('rollback'); console.log(failures ? `\n${failures} check(s) FAILED — rolled back, nothing changed.` : '\nDRY RUN passed — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) { await client.query('rollback').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1 }
await client.end()
process.exitCode = process.exitCode || (failures ? 1 : 0)
