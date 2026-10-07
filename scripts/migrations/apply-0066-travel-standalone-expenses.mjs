#!/usr/bin/env node
// plan.md §48 — apply supabase/migrations/0066_travel_standalone_expenses.sql.
//
// DEFAULT = DRY RUN: everything happens inside one transaction that is ROLLED BACK at the end,
// including a full walk-through (add expense, bad inputs, punched-out rejection, totals, claim,
// delete, mark paid). Nothing is kept. Pass --apply to commit the migration itself (the
// walk-through is still rolled back; only the migration is committed).
//
// Mark Paid / delete call a storage HTTP delete that a rollback cannot undo, so the walk-through
// only ever runs those against a throwaway claim with made-up photo paths — never real photos.
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0066-travel-standalone-expenses.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0066_travel_standalone_expenses.sql'), 'utf8')

const MUST_BE_UNCHANGED = [
  'admin_settle_travel_period', 'employee_add_travel_visit', 'employee_get_travel_journey', 'admin_get_employee_travel_journey',
  'manager_get_team_travel_journey', 'admin_get_travel_overview', 'manager_get_team_travel_summary', 'employee_get_travel_summary',
  'employee_get_travel_claims', 'admin_get_travel_claims', 'archive_deleted_travel_visits', 'admin_get_travel_analytics',
  'storage_sign_url_core', 'storage_delete_objects_core', 'log_audit', 'employee_punch', 'employee_login',
]
const EXPECTED_CHANGED = [
  'travel_summary_for_employee', 'travel_claim_totals', 'employee_submit_travel_claim', 'admin_mark_travel_claim_paid',
  'employee_get_own_travel_photo_url', 'manager_get_team_travel_photo_url', 'admin_get_travel_photo_url', 'travel_photo_is_orphaned',
]
const ALL = [...MUST_BE_UNCHANGED, ...EXPECTED_CHANGED]
const snap = async c => Object.fromEntries((await c.query(
  `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' k, md5(pg_get_functiondef(p.oid)) h,
          has_function_privilege('anon', p.oid, 'execute') anon, pg_get_function_result(p.oid) res
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[])`, [ALL])).rows.map(r => [r.k, r]))

let failures = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }

async function expectError(c, label, text, params, mustContain) {
  await c.query('savepoint s')
  try {
    await c.query(text, params)
    await c.query('rollback to savepoint s')
    ok(false, label, 'expected an error but it succeeded')
  } catch (e) {
    await c.query('rollback to savepoint s')
    ok(!mustContain || e.message.includes(mustContain), label, e.message)
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  await client.query('begin')
  await client.query(sql)
  console.log('Migration SQL ran (inside a transaction).\n')

  // ---- guardrail: nothing outside scope changed, grants/return shapes preserved ----
  const after = await snap(client)
  for (const k of Object.keys(before)) {
    const name = k.split('(')[0]
    if (MUST_BE_UNCHANGED.includes(name)) ok(before[k].h === after[k].h, `unchanged: ${k}`)
    else {
      ok(before[k].anon === after[k].anon && before[k].res === after[k].res, `signature/grant kept: ${k}`)
      ok(before[k].h !== after[k].h, `changed as planned: ${k}`)
    }
  }

  // ---- walk-through ----
  const { rows: [emp] } = await client.query(
    `select id, name from employees where name = 'Himanshu Bansal' and work_mode in ('field','both') limit 1`)
  const token = crypto.randomUUID()
  await client.query(`insert into employee_sessions (token, emp_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [token, emp.id])
  const today = (await client.query(`select (now() at time zone 'Asia/Kolkata')::date d`)).rows[0].d
  const fakePath = () => `dryrun-${crypto.randomUUID()}/receipt.jpg`
  const add = (cat, amt, p) => [`select * from employee_add_travel_expense($1,$2,$3,$4,$5)`, [token, emp.id, cat, amt, p]]

  const sumBefore = (await client.query(`select * from travel_summary_for_employee($1)`, [emp.id])).rows[0]
  console.log(`\nUsing ${emp.name}; summary before: ${sumBefore.total_km} km, expenses ${sumBefore.total_expense}`)

  // today's attendance: remember whatever it is, then force "punched out / not punched in" cases
  const { rows: att } = await client.query(`select * from attendance where emp_id = $1 and date = $2`, [emp.id, today])
  if (att.length) await client.query(`update attendance set out_time = coalesce(out_time, '23:59:00') where emp_id = $1 and date = $2`, [emp.id, today])
  else await client.query(`delete from attendance where emp_id = $1 and date = $2`, [emp.id, today])
  await expectError(client, 'rejected when NOT punched in / already punched out', ...add('Toll', 100, fakePath()), att.length ? 'punched out' : 'Punch in')

  // simulate "punched in, not out"
  if (att.length) {
    await client.query(`update attendance set in_time = coalesce(in_time, '09:00:00'), out_time = null where emp_id = $1 and date = $2`, [emp.id, today])
  } else {
    await client.query(`insert into attendance (emp_id, date, in_time) values ($1, $2, '09:00:00')`, [emp.id, today])
  }
  await expectError(client, 'rejected: bad category', ...add('Petrol', 100, fakePath()), 'Choose an expense type')
  await expectError(client, 'rejected: zero amount', ...add('Toll', 0, fakePath()), 'valid expense amount')
  await expectError(client, 'rejected: absurd amount', ...add('Toll', 5000000, fakePath()), 'too large')
  await expectError(client, 'rejected: no bill photo', ...add('Toll', 100, ''), 'bill photo')
  await expectError(client, 'rejected: wrong session token', `select * from employee_add_travel_expense($1,$2,'Toll',100,'x/y.jpg')`, [crypto.randomUUID(), emp.id], 'Invalid session')

  const p1 = fakePath(), p2 = fakePath()
  const e1 = (await client.query(...add('Toll', 150.5, p1))).rows[0]
  const e2 = (await client.query(...add('Lunch', 220, p2))).rows[0]
  ok(e1.date.toString() === today.toString() && e1.claim_id === null, 'expense saved with server date, unclaimed', `${e1.category} ₹${e1.amount}`)

  const list = (await client.query(`select * from employee_get_travel_expenses($1,$2)`, [token, emp.id])).rows
  ok(list.length === 2, 'staff can read own expenses', `${list.length} rows`)
  const sumAfter = (await client.query(`select * from travel_summary_for_employee($1)`, [emp.id])).rows[0]
  ok(Math.abs(Number(sumAfter.total_expense) - Number(sumBefore.total_expense) - 370.5) < 0.001, 'summary expense total includes them (+370.50)', `${sumBefore.total_expense} → ${sumAfter.total_expense}`)
  ok(Number(sumAfter.total_km) === Number(sumBefore.total_km) && sumAfter.visit_count === sumBefore.visit_count, 'distance and visit count unchanged')
  const tot = (await client.query(`select * from travel_claim_totals($1, $2)`, [emp.id, today])).rows[0]
  ok(Number(tot.total_expense) >= 370.5, 'claim totals include them', `total_expense ${tot.total_expense}`)

  ok((await client.query(`select travel_photo_is_orphaned($1) o`, [p1])).rows[0].o === false, 'expense receipt is NOT treated as orphan')
  ok((await client.query(`select travel_photo_is_orphaned($1) o`, [fakePath()])).rows[0].o === true, 'unknown path still orphan')
  await expectError(client, 'other employee cannot get this receipt URL', `select employee_get_own_travel_photo_url($1,$2,$3)`, [token, emp.id, fakePath()], 'Not your photo')

  // delete one (fake path → the storage delete is a harmless no-op)
  await client.query(`select employee_delete_travel_expense($1,$2,$3)`, [token, emp.id, e2.id])
  ok((await client.query(`select count(*)::int n from travel_expenses where emp_id=$1`, [emp.id])).rows[0].n === 1, 'staff can delete own unclaimed expense')
  ok((await client.query(`select count(*)::int n from audit_logs where action='TRAVEL_EXPENSE_DELETED' and ts > now() - interval '1 minute'`)).rows[0].n >= 1, 'deletion is logged in the audit log')

  // submit a claim over the real unclaimed visits + our expense (claim rows only; rolled back)
  await client.query('savepoint claim')
  try {
    const claim = (await client.query(`select * from employee_submit_travel_claim($1,$2,$3)`, [token, emp.id, today])).rows[0]
    const cl = (await client.query(`select claim_id from travel_expenses where id = $1`, [e1.id])).rows[0]
    ok(cl.claim_id === claim.id, 'claim picks up the standalone expense', `claim expense_amount ${claim.expense_amount}`)
    ok(Number(claim.expense_amount) >= 150.5, 'claim expense total includes it')
    await expectError(client, 'cannot delete an expense once claimed', `select employee_delete_travel_expense($1,$2,$3)`, [token, emp.id, e1.id], 'already part of a submitted claim')
  } catch (e) { ok(false, 'claim submit walk-through', e.message) }
  await client.query('rollback to savepoint claim')

  // Mark Paid on a THROWAWAY claim for an employee with no travel data, fake photo path only.
  const { rows: [other] } = await client.query(
    `select e.id from employees e where not exists (select 1 from travel_visits v where v.emp_id = e.id) and not exists (select 1 from travel_expenses x where x.emp_id = e.id) limit 1`)
  const adminTok = crypto.randomUUID()
  const { rows: cols } = await client.query(`select column_name, is_nullable, column_default from information_schema.columns where table_name='admin_sessions'`)
  const needed = cols.filter(c => c.is_nullable === 'NO' && !c.column_default).map(c => c.column_name)
  const vals = { token: adminTok, expires_at: new Date(Date.now() + 3600e3).toISOString() }
  if (needed.every(n => n in vals)) {
    await client.query(`insert into admin_sessions (token, expires_at) values ($1, $2)`, [vals.token, vals.expires_at])
    const { rows: [tc] } = await client.query(
      `insert into travel_claims (emp_id, period_start, period_end, total_km, distance_amount, expense_amount, amount, rate_tier, rate_per_km)
       values ($1, $2::date - 6, $2, 0, 0, 90, 90, 'executive', 0) returning id`, [other.id, today])
    await client.query(`insert into travel_expenses (emp_id, date, category, amount, photo_path, claim_id) values ($1, $2, 'Toll', 90, $3, $4)`, [other.id, today, fakePath(), tc.id])
    const paid = (await client.query(`select (claim).status as status, photo_paths from admin_mark_travel_claim_paid($1,$2)`, [adminTok, tc.id])).rows[0]
    ok(paid.status === 'Paid' && paid.photo_paths.length === 1, 'Mark Paid works and returns the expense receipt path', JSON.stringify(paid.photo_paths))
    ok((await client.query(`select count(*)::int n from travel_expenses where claim_id = $1`, [tc.id])).rows[0].n === 0, 'Mark Paid removes the claim\'s expense rows')
  } else {
    console.log('SKIP  Mark Paid test: admin_sessions needs columns', needed)
  }

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nAll checks passed.')
  if (failures || !APPLY) {
    await client.query('rollback')
    console.log(failures ? 'Rolled back — nothing changed.' : 'DRY RUN: rolled back — nothing changed. Re-run with --apply to commit the migration.')
    process.exit(failures ? 1 : 0)
  }

  // --apply: undo the walk-through's test rows but keep the migration. Simplest safe way:
  // roll everything back, then run the migration alone and commit.
  await client.query('rollback')
  await client.query('begin')
  await client.query(sql)
  const final = await snap(client)
  const bad = MUST_BE_UNCHANGED.filter(n => Object.keys(before).some(k => k.startsWith(n + '(') && before[k].h !== final[k].h))
  if (bad.length) { await client.query('rollback'); console.error('!! unexpected changes, rolled back:', bad); process.exit(1) }
  await client.query('commit')
  console.log('Migration 0066 COMMITTED to production.')
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('Aborted, rolled back:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
