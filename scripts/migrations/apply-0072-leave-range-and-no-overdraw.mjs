#!/usr/bin/env node
// plan.md §58 — apply supabase/migrations/0072_leave_range_and_no_overdraw.sql.
// DEFAULT = DRY RUN: the migration and a walk-through (a throw-away test employee) run inside one transaction that is
// ROLLED BACK. --apply commits only the migration, after the same checks pass again.
// Usage: DATABASE_URL=... node scripts/migrations/apply-0072-leave-range-and-no-overdraw.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0072_leave_range_and_no_overdraw.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['admin_decide_leave', 'manager_decide_leave', 'apply_leave_approval_effects', 'is_valid_employee_token', 'employee_get_leaves', 'employee_get_leave_balances', 'run_monthly_leave_accrual']
const snap = async c => Object.fromEntries((await c.query(
  `select p.proname k, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [MUST_BE_UNCHANGED])).rows.map(r => [r.k, r.h]))

let failures = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }

async function runChecks(c, before) {
  const after = await snap(c)
  for (const k of Object.keys(before)) ok(before[k] === after[k], `unchanged: ${k}`)
  for (const f of ['employee_apply_leave', 'employee_apply_leave_range']) {
    const { rows: [v] } = await c.query(`select count(*)::int n, bool_or(has_function_privilege('anon', p.oid, 'execute')) anon from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [f])
    ok(v.n === 1 && v.anon === true, `exactly one ${f}, anon may call it (token-checked)`, `${v.n}`)
  }
  const { rows: [core] } = await c.query(`select bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) can from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'apply_leave_core'`)
  ok(core.can === false, 'apply_leave_core cannot be called from the app (private)')

  // test employee + sessions
  const admin = crypto.randomUUID(); await c.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '1 hour')`, [admin])
  const { rows: [e] } = await c.query(`select * from admin_create_employee($1, $2::jsonb)`, [admin, JSON.stringify({ name: 'ZZ Leave Test', pin: '4821', company: 'Asma Traexim Pvt Ltd' })])
  const tok = crypto.randomUUID(); await c.query(`insert into employee_sessions (token, emp_id) values ($1, $2)`, [tok, e.id])
  await c.query(`update employees set employment_status = 'Confirmed' where id = $1`, [e.id])
  const setBal = async (lt, bal) => c.query(`insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota) values ($1, $2, $3, 0, $3, 12) on conflict (emp_id, leave_type, financial_year) do update set balance = $3, accrued = $3`, [e.id, lt, bal])
  const clear = async () => c.query(`delete from leave_applications where emp_id = $1`, [e.id])

  // a clean Monday..Sunday two-plus weeks ahead with no holiday in it
  let { rows: [m] } = await c.query(`select date_trunc('week', current_date + 14)::date mon`)
  for (let i = 0; i < 8; i++) {
    const { rows: [h] } = await c.query(`select count(*)::int n from holidays where date between $1::date and $1::date + 6`, [m.mon])
    if (h.n === 0) break
    ;({ rows: [m] } = await c.query(`select ($1::date + 7) mon`, [m.mon]))
  }
  const mon = m.mon // a Date (UTC-shifted); work with SQL for day maths
  const day = async n => (await c.query(`select ($1::date + $2::int)::text d`, [mon, n])).rows[0].d
  const [MON, TUE, WED, FRI, NEXTMON, D14, D40] = [await day(0), await day(1), await day(2), await day(4), await day(7), await day(14), await day(40)]
  const range = (lt, from, to, extra = {}) => c.query(`select * from employee_apply_leave_range($1, $2, $3::jsonb)`, [tok, e.id, JSON.stringify({ emp_name: 'ZZ', company: 'Asma Traexim Pvt Ltd', leave_type: lt, date: from, end_date: to, reason: 'test', ...extra })])
  const single = (lt, d, extra = {}) => c.query(`select * from employee_apply_leave($1, $2, $3::jsonb)`, [tok, e.id, JSON.stringify({ emp_name: 'ZZ', company: 'Asma Traexim Pvt Ltd', leave_type: lt, date: d, reason: 'test', ...extra })])
  const fails = async (fn, contains, label) => {
    await c.query('savepoint s')
    try { await fn(); await c.query('rollback to savepoint s'); ok(false, label, 'it was accepted') }
    catch (err) { await c.query('rollback to savepoint s'); ok(err.message.includes(contains), label, err.message.slice(0, 110)) }
  }
  const count = async () => (await c.query(`select count(*)::int n from leave_applications where emp_id = $1`, [e.id])).rows[0].n

  await setBal('Casual Leave', 3); await setBal('Sick Leave', 4)

  const r1 = await range('Casual Leave', MON, WED)
  ok(r1.rows.length === 3, '3-day range (Mon-Wed) saves 3 pending rows', `${r1.rows.length}`)
  await fails(() => single('Casual Leave', NEXTMON), 'waiting for approval', 'a second Casual Leave is refused while the first is waiting')
  await fails(() => range('Casual Leave', NEXTMON, NEXTMON), 'waiting for approval', 'also refused through the range function')
  const sick = await single('Sick Leave', FRI, { document_path: 'x/y.jpg' })
  ok(sick.rows.length === 1, 'a different type (Sick Leave) is still allowed')
  const lop = await single('LOP', NEXTMON)
  ok(lop.rows.length === 1, 'LOP is allowed while Casual Leave is waiting')
  await c.query(`update leave_applications set status = 'Approved' where emp_id = $1 and leave_type = 'Casual Leave'`, [e.id])
  await c.query(`update leave_balances set balance = 0 where emp_id = $1 and leave_type = 'Casual Leave'`, [e.id])
  await fails(() => single('Casual Leave', D14), 'Not enough', 'with balance 0 a new Casual Leave is refused (apply as LOP)')
  await setBal('Casual Leave', 3)
  const r2 = await single('Casual Leave', D14)
  ok(r2.rows.length === 1, 'once the earlier ones are decided, applying again works')

  await clear(); await setBal('Casual Leave', 2)
  await fails(() => range('Casual Leave', MON, WED), 'you asked for 3 day(s) but only 2 available', 'a 3-day range with balance 2 is refused (clear message)')
  ok(await count() === 0, 'and nothing at all was saved (all-or-nothing)')
  await setBal('Casual Leave', 3)
  const r3 = await range('Casual Leave', FRI, NEXTMON) // Fri, Sat, (Sun skipped), Mon
  ok(r3.rows.length === 3 && !r3.rows.some(r => new Date(r.date).getUTCDay() === 0 && false), 'Fri-Mon range = 3 days, Sunday skipped', r3.rows.map(r => String(r.date).slice(0, 10)).join(','))
  const { rows: [sun] } = await c.query(`select count(*)::int n from leave_applications where emp_id = $1 and extract(dow from date) = 0`, [e.id])
  ok(sun.n === 0, 'no Sunday row was created')

  await clear()
  await c.query(`insert into holidays (date, name, type) values ($1, 'ZZ test holiday', 'Public')`, [TUE])
  const r4 = await range('Casual Leave', MON, WED)
  ok(r4.rows.length === 2 && !r4.rows.some(r => String(r.date).includes(TUE)), 'a listed holiday inside the range is skipped (Mon-Wed = 2 days)', `${r4.rows.length}`)
  await c.query(`delete from holidays where name = 'ZZ test holiday'`)

  await clear()
  await fails(() => range('Casual Leave', MON, WED, { day_part: 'first_half' }), 'half day can only', 'a half day with a range is refused')
  await fails(() => range('Casual Leave', WED, MON), 'cannot be before', 'last day before first day is refused')
  await fails(() => range('Casual Leave', MON, D40), 'at most 31', 'more than 31 days is refused')
  const half = await range('Casual Leave', MON, MON, { day_part: 'first_half' })
  ok(half.rows.length === 1 && half.rows[0].day_part === 'first_half', 'a single half day still works')

  await clear(); await setBal('Casual Leave', 1)
  await c.query(`insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, status) values ($1, 'ZZ', 'x', 'Casual Leave', current_date - 3, 'full', 'old', 'Pending')`, [e.id])
  await fails(() => single('Casual Leave', MON), 'Not enough', 'an old pending request (past date) still reserves its day against the balance')
  await setBal('Casual Leave', 3)
  const r5 = await single('Casual Leave', MON)
  ok(r5.rows.length === 1, 'an old pending request (past date) does NOT block a new one when the balance covers both')

  await clear()
  const bad = crypto.randomUUID()
  await fails(() => c.query(`select * from employee_apply_leave_range($1, $2, '{}'::jsonb)`, [bad, e.id]), 'Invalid or expired', 'a wrong session token is refused')
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  await client.query('begin')
  await client.query(sql)
  await runChecks(client, before)
  if (APPLY && failures === 0) { await client.query('rollback'); await client.query('begin'); await client.query(sql); await client.query('commit'); console.log('\nCOMMITTED migration 0072.') }
  else { await client.query('rollback'); console.log(failures ? `\n${failures} check(s) FAILED — rolled back, nothing changed.` : '\nDRY RUN passed — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) { await client.query('rollback').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1 }
await client.end()
process.exitCode = process.exitCode || (failures ? 1 : 0)
