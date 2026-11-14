#!/usr/bin/env node
// plan.md §62 — migration 0076: Casual / Earned / Sick Leave for a past day of the current month.
// Default run = DRY RUN: proves live apply_leave_core == the 0074 file, installs 0076 inside a transaction, runs every
// test case (each in its own savepoint), then ROLLS EVERYTHING BACK. Nothing in prod changes.
// With --apply: same checks, and only if every test passed, installs 0076 for real (function only; no data touched).
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0076-leave-past-day-same-month.mjs [--apply]

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations')
const connectionString = process.env.DATABASE_URL
const APPLY = process.argv.includes('--apply')
if (!connectionString) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const sql = fs.readFileSync(path.join(MIG, '0076_leave_past_day_same_month.sql'), 'utf8')
const norm = s => s.replace(/\s+/g, ' ').trim()
const bodyFromFile = (file, name) => {
  const m = fs.readFileSync(path.join(MIG, file), 'utf8').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, 'i'))
  if (!m) throw new Error(`no ${name} in ${file}`)
  return norm(m[1])
}
let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  // 1. live == repo
  const { rows: live } = await client.query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_leave_core'`)
  check('live apply_leave_core == 0074 file', live.length === 1 && norm(live[0].prosrc) === bodyFromFile('0074_od_wfh_times_and_regularization_both_times.sql', 'apply_leave_core'))
  const { rows: cols } = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='attendance' and column_name in ('in_time','out_time','app_in_time','app_out_time')`)
  check('attendance has in_time/out_time/app_in_time/app_out_time', cols.length === 4, cols.map(c => c.column_name).join(','))
  if (failed) { console.log('\nLive code differs from the repo — nothing changed.'); process.exit(1) }

  // 2. dry run in a transaction
  await client.query('begin')
  await client.query(sql)
  const { rows: [d] } = await client.query(`select to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD') as today,
     to_char(date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date,'YYYY-MM-DD') as mstart,
     to_char(date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date - 1,'YYYY-MM-DD') as prev,
     to_char((now() at time zone 'Asia/Kolkata')::date + 1,'YYYY-MM-DD') as tomorrow,
     to_char((now() at time zone 'Asia/Kolkata')::date - 1,'YYYY-MM-DD') as yesterday`)
  console.log(`IST today ${d.today}; month starts ${d.mstart}; previous-month day ${d.prev}`)

  const { rows: emps } = await client.query(`
    select e.id, e.name from employees e
    where e.deleted_at is null and coalesce(e.employment_status,'') not in ('Probation','Notice Period')
      and coalesce(e.company,'') <> 'Asma + Production Plant'
      and (select count(*) from leave_balances b where b.emp_id=e.id and b.financial_year=current_fy()
             and b.leave_type in ('Sick Leave','Casual Leave','Earned Leave') and b.balance >= 3) = 3
    order by e.name limit 1`)
  if (!emps.length) throw new Error('no suitable test employee (needs SL/CL/EL balance >= 3)')
  const E = emps[0].id
  console.log(`Test employee (all changes rolled back): ${emps[0].name}`)
  await client.query(`delete from leave_applications where emp_id=$1`, [E])
  await client.query(`delete from attendance where emp_id=$1 and date between $2::date - 40 and $3::date + 10`, [E, d.mstart, d.today])

  let sp = 0
  async function core(type, date, extra = {}, prep) {
    const name = `t${++sp}`
    await client.query(`savepoint ${name}`)
    try {
      if (prep) await prep()
      const data = { leave_type: type, date, day_part: 'full', reason: 't', emp_name: 'T', company: 'X', document_path: type === 'Sick Leave' ? 'doc.pdf' : '', ...extra }
      const { rows } = await client.query(`select * from apply_leave_core($1, $2::jsonb, true)`, [E, JSON.stringify(data)])
      return { ok: true, row: rows[0] }
    } catch (e) { return { ok: false, err: e.message } }
    finally { await client.query(`rollback to savepoint ${name}`) }
  }
  const expectOk = async (label, ...a) => { const r = await core(...a); check(label, r.ok, r.ok ? '' : r.err) }
  const expectErr = async (label, re, ...a) => { const r = await core(...a); check(label, !r.ok && re.test(r.err), r.ok ? 'was ACCEPTED' : r.err) }
  const putAttendance = (date, cols) => () => client.query(`insert into attendance (emp_id, date, ${Object.keys(cols).join(',')}) values ($1,$2, ${Object.keys(cols).map((_, i) => `$${i + 3}`).join(',')})`, [E, date, ...Object.values(cols)])

  const pastInMonth = d.today > d.mstart ? d.yesterday : null
  if (pastInMonth) {
    await expectOk('Casual Leave, past day this month, no record', 'Casual Leave', pastInMonth)
    await expectOk('Earned Leave, past day this month', 'Earned Leave', pastInMonth)
    await expectOk('Sick Leave (with document), past day this month', 'Sick Leave', pastInMonth)
    await expectOk('Casual half-day (first_half), past day this month', 'Casual Leave', pastInMonth, { day_part: 'first_half' })
    await expectOk('1st of the month itself is allowed', 'Casual Leave', d.mstart)
    await expectOk('Absent-status row with no punch → allowed', 'Casual Leave', pastInMonth, {}, putAttendance(pastInMonth, { status: 'Absent' }))
    await expectErr('punch-in + punch-out → blocked', /attendance for/, 'Casual Leave', pastInMonth, {}, putAttendance(pastInMonth, { in_time: '09:30', out_time: '18:30' }))
    await expectErr('punch-in only (forgot punch-out) → blocked', /attendance for/, 'Casual Leave', pastInMonth, {}, putAttendance(pastInMonth, { in_time: '09:30' }))
    await expectErr('app punch-in only → blocked', /attendance for/, 'Sick Leave', pastInMonth, {}, putAttendance(pastInMonth, { app_in_time: '09:30' }))
    await expectErr('punched day blocked for Earned too', /attendance for/, 'Earned Leave', pastInMonth, {}, putAttendance(pastInMonth, { in_time: '10:00', out_time: '19:00' }))
    await expectErr('Casual: duplicate request for the same date → blocked', /already exists/, 'Casual Leave', pastInMonth, {}, async () => {
      await client.query(`insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, status) values ($1,'T','X','Casual Leave',$2,'full','t','Pending')`, [E, pastInMonth])
    })
    await expectErr('past day but balance 0 → no overdraw', /Not enough/, 'Casual Leave', pastInMonth, {}, async () => {
      await client.query(`update leave_balances set balance=0 where emp_id=$1 and leave_type='Casual Leave' and financial_year=current_fy()`, [E])
    })
  } else console.log('(today is the 1st — past-day-in-month cases skipped)')
  await expectErr('Casual Leave, previous month → refused', /within the current month/, 'Casual Leave', d.prev)
  await expectErr('Earned Leave, previous month → refused', /within the current month/, 'Earned Leave', d.prev)
  await expectErr('Sick Leave, previous month → refused (now limited)', /within the current month/, 'Sick Leave', d.prev)
  await expectErr('Partial Leave 1h, past day → still refused', /past date/, 'Partial Leave - 1 Hour', pastInMonth || d.prev)
  await expectOk('Partial Leave 1h, today → still allowed', 'Partial Leave - 1 Hour', d.today)
  await expectOk('Casual Leave, today → as before', 'Casual Leave', d.today)
  await expectOk('Casual Leave, tomorrow → as before', 'Casual Leave', d.tomorrow)
  await expectOk('Sick Leave, tomorrow → as before', 'Sick Leave', d.tomorrow)
  await expectOk('Bereavement Leave, past day → unchanged (was never limited)', 'Bereavement Leave', pastInMonth || d.prev)
  await expectErr('Work From Home without times → still refused (§60 kept)', /in-time and out-time/, 'Work From Home', d.today)
  await expectErr('On Duty for a past day → still "today only" (§60 kept)', /only be applied for today/, 'On Duty', pastInMonth || d.prev, { requested_in: '09:00', requested_out: '18:00' })
  await expectOk('Work From Home today with times → still allowed', 'Work From Home', d.today, { requested_in: '09:00', requested_out: '18:00' })
  await expectErr('Paternity Leave, today → still "a day in advance"', /at least a day in advance/, 'Paternity Leave', d.today)

  // approval of a past leave: balance deducted, day becomes Leave, punch data untouched
  if (pastInMonth) {
    await client.query('savepoint appr')
    const r = await client.query(`select * from apply_leave_core($1,$2::jsonb,true)`, [E, JSON.stringify({ leave_type: 'Casual Leave', date: pastInMonth, day_part: 'full', reason: 't', emp_name: 'T', company: 'X' })])
    const bal0 = (await client.query(`select balance from leave_balances where emp_id=$1 and leave_type='Casual Leave' and financial_year=current_fy()`, [E])).rows[0].balance
    await client.query(`select apply_leave_approval_effects(la) from leave_applications la where la.id = $1`, [r.rows[0].id])
    const bal1 = (await client.query(`select balance from leave_balances where emp_id=$1 and leave_type='Casual Leave' and financial_year=current_fy()`, [E])).rows[0].balance
    const att = (await client.query(`select status, leave_type from attendance where emp_id=$1 and date=$2`, [E, pastInMonth])).rows[0]
    check('approval: balance down by 1', Number(bal0) - Number(bal1) === 1, `${bal0} → ${bal1}`)
    check('approval: attendance day becomes Leave', att && att.status === 'Leave' && att.leave_type === 'Casual Leave', JSON.stringify(att))
    await client.query('rollback to savepoint appr')
  }

  await client.query('rollback')
  console.log('\nDry run rolled back — production unchanged.')
  if (failed) { console.log(`\n${failed} CHECK(S) FAILED — not applying.`); process.exit(1) }
  console.log('\nAll checks passed.')

  if (APPLY) {
    await client.query('begin')
    await client.query(sql)
    const { rows } = await client.query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_leave_core'`)
    if (norm(rows[0].prosrc) !== bodyFromFile('0076_leave_past_day_same_month.sql', 'apply_leave_core')) throw new Error('installed body differs from the file')
    await client.query(`select log_audit('MIGRATION', 'Migration 0076 applied: leave for a past day of the current month (CL/EL/SL), plan.md §62', 'system')`)
    await client.query('commit')
    console.log('✓ Migration 0076 is LIVE.')
  } else {
    console.log('Re-run with --apply to install it for real.')
  }
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('\nERROR:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
