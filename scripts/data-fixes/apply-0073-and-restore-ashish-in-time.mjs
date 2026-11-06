#!/usr/bin/env node
// plan.md §59 — two things, in one transaction:
//   1. Apply migration 0073 (employee_punch refuses a second punch-in for the same day).
//   2. Put Ashish Singh's 5 Nov 2026 punch-in back to the MORNING time. The evening tap
//      (6:48 PM) overwrote it; the location log kept the real morning punch, so that is the proof.
//      Only in_time / app_in_time / in_location / in_lat / in_lon / in_accuracy_m are touched.
//      His punch-out is NOT guessed — HR decides that.
//
// DEFAULT = DRY RUN. --apply: JSON backup of his row first, then the changes in one transaction,
// then a self-test of the new rule inside a transaction that is rolled back.
// Usage: DATABASE_URL=... node scripts/data-fixes/apply-0073-and-restore-ashish-in-time.mjs [--apply]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const EMP = '5af0f609-5bf5-461e-bc56-a2713058e901' // Ashish Singh
const DAY = '2026-11-05'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows: [row] } = await client.query(`select * from attendance where emp_id=$1 and date=$2`, [EMP, DAY])
  // morning punch-in = earliest punch_in log of that IST day
  const { rows: logs } = await client.query(
    `select lat_lon, lat, lon, accuracy_m, captured_at,
            (captured_at at time zone 'Asia/Kolkata')::time as ist_time
       from location_logs
      where emp_id=$1 and date=$2 and type='punch_in' order by captured_at`, [EMP, DAY])
  console.log('Current row  :', { in_time: row?.in_time, out_time: row?.out_time, status: row?.status })
  console.log('Punch-in logs:', logs.map(l => `${l.ist_time} IST`))
  if (!row || logs.length < 2) throw new Error('Expected the row and two punch_in logs (morning + evening) — stopping, nothing changed.')
  const morning = logs[0]
  console.log(`Will restore in_time to ${morning.ist_time} (was ${row.in_time}).`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0) }

  const backup = `scripts/data-fixes/backup-ashish-attendance-${DAY}.json`
  fs.writeFileSync(backup, JSON.stringify(row, null, 2))
  console.log('Backup written:', backup)

  const sql = fs.readFileSync('supabase/migrations/0073_single_punch_in_per_day.sql', 'utf8')
  await client.query('begin')
  await client.query(sql)
  const upd = await client.query(
    `update attendance set in_time=$3, app_in_time=$3, in_location=$4, in_lat=$5, in_lon=$6, in_accuracy_m=$7, updated_at=now()
      where emp_id=$1 and date=$2 and in_time > $3`,
    [EMP, DAY, morning.ist_time, morning.lat_lon, morning.lat, morning.lon, morning.accuracy_m])
  if (upd.rowCount !== 1) throw new Error(`Expected to fix exactly 1 row, got ${upd.rowCount}`)
  await client.query(`select log_audit('ATTENDANCE_FIX', $1, 'system')`,
    [`Ashish Singh ${DAY} — punch-in restored to ${morning.ist_time} IST (evening tap had overwritten it); proof: location log`])
  await client.query('commit')
  console.log('Applied: function replaced + Ashish\'s morning time restored.')

  // Self-test, rolled back: pretend the session is valid, try a SECOND punch-in as Ashish.
  await client.query('begin')
  try {
    await client.query(`create or replace function public.is_valid_employee_token(p_token uuid, p_emp_id uuid) returns boolean language sql as 'select true'`)
    const { rows: [e] } = await client.query(`select punch_device_id from employees where id=$1`, [EMP])
    // The rule is date-based on the server clock; Ashish's row for 'today' may not exist, so use the
    // real today row if it has an in_time (it does: 6 Nov evening punch).
    await client.query('savepoint t')
    let msg = 'NO ERROR (rule did not fire!)'
    try { await client.query(`select employee_punch(gen_random_uuid(), $1, '{"punch_type":"in"}'::jsonb, $2)`, [EMP, e.punch_device_id]) }
    catch (err) { msg = err.message }
    console.log('Self-test (second punch-in) ->', msg)
  } finally { await client.query('rollback') }
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('FAILED, rolled back:', e.message); process.exitCode = 1
} finally { await client.end() }
