#!/usr/bin/env node
// plan.md §56 — apply supabase/migrations/0070_earned_leave_same_day.sql.
//
// DEFAULT = DRY RUN: the migration and a walk-through run inside one transaction that is ROLLED BACK (any test
// leave / session / balance edit disappears with it). Pass --apply to commit only the migration, after the same
// checks pass again.
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0070-earned-leave-same-day.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0070_earned_leave_same_day.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['manager_decide_leave', 'admin_decide_leave', 'employee_get_leaves', 'employee_punch', 'is_valid_employee_token', 'log_audit']
const snap = async c => Object.fromEntries((await c.query(
  `select p.proname k, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [MUST_BE_UNCHANGED])).rows.map(r => [r.k, r.h]))

let failures = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }
async function apply(c, token, empId, type, date, part = 'full') {
  await c.query('savepoint s')
  try {
    const { rows: [r] } = await c.query(`select * from employee_apply_leave($1, $2, $3::jsonb)`, [token, empId, JSON.stringify({ leave_type: type, date, day_part: part, emp_name: 'Test', company: 'Test', reason: 'dry run' })])
    await c.query('release savepoint s')
    return { ok: true, row: r }
  } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: e.message } }
}

async function runChecks(c, before) {
  const after = await snap(c)
  for (const k of Object.keys(before)) ok(before[k] === after[k], `unchanged: ${k}`)
  const { rows: [vs] } = await c.query(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'employee_apply_leave'`)
  ok(vs.n === 1, 'exactly one version of employee_apply_leave', String(vs.n))
  ok((await c.query(`select has_function_privilege('anon', 'employee_apply_leave(uuid,uuid,jsonb)', 'execute') v`)).rows[0].v, 'anon may still call it (token-checked)')

  // a Confirmed employee with a Casual and an Earned balance and no leave in the next few days
  const { rows: [emp] } = await c.query(`
    select e.id from employees e
    where e.deleted_at is null and e.active and e.employment_status = 'Confirmed' and coalesce(e.company, '') <> 'Asma + Production Plant'
      and exists (select 1 from leave_balances b where b.emp_id = e.id and b.leave_type = 'Earned Leave' and b.financial_year = current_fy() and b.balance >= 2)
      and exists (select 1 from leave_balances b where b.emp_id = e.id and b.leave_type = 'Casual Leave' and b.financial_year = current_fy() and b.balance >= 2)
      and not exists (select 1 from leave_applications l where l.emp_id = e.id and l.date between current_date - 2 and current_date + 6)
    order by e.name limit 1`)
  if (!emp) { ok(false, 'found a test employee'); return }
  const token = crypto.randomUUID()
  await c.query(`insert into employee_sessions (token, emp_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [token, emp.id])
  const { rows: [{ d: today }] } = await c.query(`select to_char(current_date, 'YYYY-MM-DD') d`)
  const day = n => c.query(`select to_char(current_date + $1::int, 'YYYY-MM-DD') d`, [n]).then(r => r.rows[0].d)

  let r = await apply(c, token, emp.id, 'Earned Leave', today)
  ok(r.ok && r.row.status === 'Pending', 'Earned Leave for TODAY is accepted', r.msg || '')
  r = await apply(c, token, emp.id, 'Earned Leave', await day(2), 'first_half')
  ok(r.ok, 'Earned Leave half-day in 2 days is accepted', r.msg || '')
  r = await apply(c, token, emp.id, 'Earned Leave', await day(-1))
  ok(!r.ok && r.msg.includes('cannot be applied for a past date'), 'Earned Leave for YESTERDAY is still rejected', r.msg || '')
  r = await apply(c, token, emp.id, 'Casual Leave', await day(-1))
  ok(!r.ok && r.msg.includes('cannot be applied for a past date'), 'Casual Leave for yesterday still rejected (unchanged)', r.msg || '')
  r = await apply(c, token, emp.id, 'Casual Leave', await day(3))
  ok(r.ok, 'Casual Leave in 3 days still accepted (unchanged)', r.msg || '')
  r = await apply(c, token, emp.id, 'Earned Leave', today)
  ok(!r.ok && r.msg.includes('already exists'), 'a second application for the same day is still blocked', r.msg || '')

  // balance guard unchanged: no EL balance left -> rejected
  await c.query(`update leave_balances set balance = 0 where emp_id = $1 and leave_type = 'Earned Leave' and financial_year = current_fy()`, [emp.id])
  r = await apply(c, token, emp.id, 'Earned Leave', await day(5))
  ok(!r.ok && r.msg.includes('Insufficient'), 'Earned Leave with no balance is still rejected', r.msg || '')
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  await client.query('begin')
  await client.query(sql)
  await runChecks(client, before)
  if (APPLY && failures === 0) { await client.query('rollback'); await client.query('begin'); await client.query(sql); await client.query('commit'); console.log('\nCOMMITTED migration 0070.') }
  else { await client.query('rollback'); console.log(failures ? `\n${failures} check(s) FAILED — rolled back, nothing changed.` : '\nDRY RUN passed — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) { await client.query('rollback').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1 }
await client.end()
process.exitCode = process.exitCode || (failures ? 1 : 0)
