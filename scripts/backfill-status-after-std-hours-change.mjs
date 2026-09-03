#!/usr/bin/env node
// One-off backfill, plan.md §15.2: attendance.status is computed once (at punch time)
// and never recalculated. Admin changed app_settings.std_hours from 9 to 8 on
// 2026-09-01 (audit_logs SETTINGS_UPDATE), but a bug in useAuth.js meant employees
// whose app was already open kept computing status against the stale 9h target —
// so some post-change rows are still frozen with the wrong status (e.g. someone who
// worked 8h20m, comfortably meeting the new 8h target, still shows "Half Day" because
// their punch was checked against 9h). That root cause is fixed separately (punch now
// always fetches std_hours fresh); this script only corrects the rows it already
// affected — every completed punch recorded strictly after the settings change,
// recomputed with the *actual* calcStatus/explainShortfall logic (imported directly,
// not reimplemented) against the *current* std_hours.
//
// Usage (dry run by default — prints the diff, writes nothing):
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/backfill-status-after-std-hours-change.mjs
//
// Add --apply to actually write:
//   ... node scripts/backfill-status-after-std-hours-change.mjs --apply

import pg from 'pg'
import { calcStatus } from '../src/lib/datetime.js'
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
  const stdHours = Number(settingsRows[0].std_hours)

  const { rows: cutoffRows } = await client.query(
    `select ts from audit_logs where action = 'SETTINGS_UPDATE' and detail ilike '%std_hours%' order by ts desc limit 1`
  )
  if (!cutoffRows.length) {
    console.error('No SETTINGS_UPDATE audit log found for std_hours — nothing to anchor the cutoff to. Aborting.')
    process.exit(1)
  }
  const cutoffTs = cutoffRows[0].ts
  console.log(`Current std_hours: ${stdHours}. Recomputing status for punches recorded after ${cutoffTs.toISOString()} (the last std_hours change).`)

  const { rows } = await client.query(
    `select a.id, e.name, to_char(a.date, 'YYYY-MM-DD') as date, a.in_time, a.out_time, a.leave_type, a.day_part, a.status, a.updated_at
       from attendance a join employees e on e.id = a.emp_id
      where a.updated_at > $1 and a.in_time is not null and a.out_time is not null
      order by a.date`,
    [cutoffTs]
  )
  console.log(`Checked ${rows.length} completed punches recorded after the change.`)

  const diffs = []
  for (const r of rows) {
    const rec = { inTime: r.in_time.slice(0, 5), outTime: r.out_time.slice(0, 5), leaveType: r.leave_type, dayPart: r.day_part }
    const freshStatus = calcStatus(rec, stdHours, DAY_TYPES.WORKING)
    if (freshStatus !== r.status) {
      diffs.push({ ...r, freshStatus })
    }
  }

  console.log(`\n${diffs.length} row(s) would change:`)
  for (const d of diffs) {
    console.log(`  ${d.name.padEnd(24)} ${d.date}  ${d.in_time.slice(0,5)}-${d.out_time.slice(0,5)}  "${d.status}" -> "${d.freshStatus}"`)
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
        ['ATTENDANCE_CORRECTION', `Backfilled status on ${diffs.length} row(s) frozen with a stale std_hours (9) after admin changed it to ${stdHours} on 2026-09-01 — see plan.md 15.2`]
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
