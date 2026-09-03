#!/usr/bin/env node
// One-off correction, plan.md §15.2 (revised): admin's 2026-09-01 change of std_hours
// from 9 to 8 turns out to have been a mistake — the real policy is a 9-hour shift with
// a flexible 9:00-10:00 AM punch-in / 6:00-7:00 PM punch-out window (WORK_WINDOW_START/
// END in constants.js, already built around a 9h shift: 19:00 - 09:00 = 10:00 latest
// on-time start). This script:
//   1. Sets app_settings.std_hours back to 9 (mirrors admin_update_settings's own
//      update + audit_logs entry, since this runs outside the app as a direct DB fix).
//   2. Recomputes status for every completed punch dated 2026-09-01 or later against
//      std_hours=9 — using the real calcStatus, not reimplemented — superseding the
//      previous backfill-status-after-std-hours-change.mjs run (which corrected these
//      same rows against 8, the value now known to be wrong).
//
// Usage (dry run by default — prints the diff, writes nothing):
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/revert-std-hours-to-9.mjs
//
// Add --apply to actually write:
//   ... node scripts/revert-std-hours-to-9.mjs --apply

import pg from 'pg'
import { calcStatus } from '../src/lib/datetime.js'
import { DAY_TYPES } from '../src/lib/constants.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
const CORRECT_STD_HOURS = 9
const CUTOFF_DATE = '2026-09-01' // the date std_hours first became wrong (changed from 9 to 8)

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const { rows: settingsRows } = await client.query(`select std_hours from app_settings limit 1`)
  const currentStdHours = Number(settingsRows[0].std_hours)
  const needsSettingUpdate = currentStdHours !== CORRECT_STD_HOURS
  console.log(`Current std_hours in database: ${currentStdHours}. Target: ${CORRECT_STD_HOURS}.${needsSettingUpdate ? '' : ' Already correct — will only recompute rows, no setting change.'}`)

  const { rows } = await client.query(
    `select a.id, e.name, to_char(a.date, 'YYYY-MM-DD') as date, a.in_time, a.out_time, a.leave_type, a.day_part, a.status
       from attendance a join employees e on e.id = a.emp_id
      where a.date >= $1 and a.in_time is not null and a.out_time is not null
      order by a.date`,
    [CUTOFF_DATE]
  )
  console.log(`Checked ${rows.length} completed punches dated ${CUTOFF_DATE} or later.`)

  const diffs = []
  for (const r of rows) {
    const rec = { inTime: r.in_time.slice(0, 5), outTime: r.out_time.slice(0, 5), leaveType: r.leave_type, dayPart: r.day_part }
    const freshStatus = calcStatus(rec, CORRECT_STD_HOURS, DAY_TYPES.WORKING)
    if (freshStatus !== r.status) {
      diffs.push({ ...r, freshStatus })
    }
  }

  console.log(`\n${diffs.length} row(s) would change against std_hours=${CORRECT_STD_HOURS}:`)
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
    if (needsSettingUpdate) {
      await client.query(`update app_settings set std_hours = $1 where id = 1`, [CORRECT_STD_HOURS])
      await client.query(
        `insert into audit_logs (action, detail, by_name) values ($1, $2, 'admin')`,
        ['SETTINGS_UPDATE', `std_hours=${CORRECT_STD_HOURS}`]
      )
    }
    for (const d of diffs) {
      await client.query(`update attendance set status = $1, updated_at = now() where id = $2`, [d.freshStatus, d.id])
    }
    if (diffs.length) {
      await client.query(
        `insert into audit_logs (action, detail, by_name) values ($1, $2, 'admin')`,
        ['ATTENDANCE_CORRECTION', `Reverted std_hours to 9 (the correct policy value) and recomputed status on ${diffs.length} row(s) dated ${CUTOFF_DATE}+ that had been computed against 8 — see plan.md 15.2`]
      )
    }
    await client.query('commit')
    console.log(`\nApplied. std_hours is ${CORRECT_STD_HOURS}${needsSettingUpdate ? ' (just set)' : ' (already was)'}. ${diffs.length} row(s) updated.`)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
