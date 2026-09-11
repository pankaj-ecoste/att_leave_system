#!/usr/bin/env node
// One-off cleanup, plan.md §15.2 — attendance.status is computed once (at punch time
// or admin edit) and stored. Every time calcStatus's logic has been improved since (the
// 15-min grace period, Partial Leave hour-credit, the late-punch-in work-window
// forgiveness, ...), rows punched *before* that fix kept showing whatever status was
// correct under the OLD logic, forever — because nothing ever recomputed them. That's
// the root cause behind the same "wrong Half Day/Absent badge" report recurring on a
// different date each time (2026-09-11 WhatsApp screenshot: 09:29-18:30, 9h01m worked,
// stdHours 9 — comfortably Present under the current grace-period rule, but the row was
// still frozen at "Half Day" from whatever logic was live when it was punched on
// 2026-09-09).
//
// The actual fix (separate commit, same date) makes every screen that shows a per-day
// status badge recompute it live via calcStatus instead of trusting the stored column
// — AttendanceHistory.jsx, MonthlySummary.jsx, AttendanceGrid.jsx, Dashboard.jsx,
// TeamPanel.jsx, Reports.jsx. That closes the bug permanently for anything the UI
// displays going forward, without needing a script like this one ever again for THAT
// purpose. This script exists only to clean up the stored `attendance.status` column
// itself, which a couple of things still read directly:
//   - refresh_attendance_monthly_summary() trigger (0002_hrms_schema.sql) — aggregates
//     `count(*) filter (where status = 'Half Day')` etc. into attendance_monthly_summary
//   - Database.jsx (admin's raw-table viewer) deliberately shows the stored value as-is
//     (it's a debugging tool for the actual row, not a "what's true" view) — unaffected
//     by this script's *purpose*, but its display will of course reflect whatever this
//     script writes, same as any other column edit.
//
// Recomputes EVERY completed punch (in_time and out_time both set) against current
// calcStatus/effectiveStdHours — no date cutoff, unlike the narrower
// backfill-status-after-std-hours-change.mjs this is modeled on, since this isn't tied
// to one settings change; it's cleaning up drift from every calcStatus fix to date.
//
// Usage (dry run by default — prints the diff, writes nothing):
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/backfill-attendance-status-live.mjs
//
// Add --apply to actually write:
//   ... node scripts/backfill-attendance-status-live.mjs --apply

import pg from 'pg'
import { calcStatus, effectiveStdHours } from '../src/lib/datetime.js'
import { DAY_TYPES } from '../src/lib/constants.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}
const apply = process.argv.includes('--apply')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const { rows: settingsRows } = await client.query(`select std_hours from app_settings limit 1`)
  const globalStdHours = Number(settingsRows[0].std_hours)

  const { rows: empRows } = await client.query(`select id, std_hours_override from employees`)
  const overrideById = Object.fromEntries(empRows.map(e => [e.id, e.std_hours_override]))

  const { rows } = await client.query(
    `select a.id, e.name, to_char(a.date, 'YYYY-MM-DD') as date, a.emp_id, a.in_time, a.out_time,
            a.leave_type, a.day_part, a.day_type, a.status
       from attendance a join employees e on e.id = a.emp_id
      where a.in_time is not null and a.out_time is not null
      order by a.date`
  )
  console.log(`Checked ${rows.length} completed punches (all-time) against current calcStatus.`)

  const diffs = []
  for (const r of rows) {
    const empStdHours = effectiveStdHours({ stdHoursOverride: overrideById[r.emp_id] }, globalStdHours)
    const rec = { inTime: r.in_time.slice(0, 5), outTime: r.out_time.slice(0, 5), leaveType: r.leave_type, dayPart: r.day_part }
    const dayType = r.day_type || DAY_TYPES.WORKING
    const freshStatus = calcStatus(rec, empStdHours, dayType)
    if (freshStatus !== r.status) {
      diffs.push({ ...r, freshStatus })
    }
  }

  console.log(`\n${diffs.length} row(s) would change:`)
  for (const d of diffs) {
    console.log(`  ${d.name.padEnd(24)} ${d.date}  ${d.in_time.slice(0, 5)}-${d.out_time.slice(0, 5)}  "${d.status}" -> "${d.freshStatus}"`)
  }

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to write these updates.')
    await client.end()
    return
  }

  await client.query('begin')
  try {
    for (const d of diffs) {
      await client.query(`update attendance set status = $1, updated_at = now() where id = $2`, [d.freshStatus, d.id])
    }
    if (diffs.length) {
      await client.query(
        `insert into audit_logs (action, detail, by_name) values ($1, $2, 'admin')`,
        ['ATTENDANCE_CORRECTION', `Backfilled status on ${diffs.length} row(s) frozen under stale calcStatus logic (all-time recompute) — see plan.md 15.2 / §24`]
      )
    }
    await client.query('commit')
    console.log(`\nApplied. ${diffs.length} row(s) updated.`)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
