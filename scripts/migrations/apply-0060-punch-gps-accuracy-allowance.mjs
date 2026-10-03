#!/usr/bin/env node
// One-off: apply supabase/migrations/0060_punch_gps_accuracy_allowance.sql (plan.md §41).
//
// Safety, in order:
//   1. The LIVE employee_punch must match migration 0038's body (whitespace-insensitive). If
//      production has drifted from the repo (it has before — plan.md §32/2026-09-04), this
//      stops BEFORE overwriting anything.
//   2. After applying, the live function must equal the old live function with ONLY the radius
//      check swapped — nothing else changed.
//   3. A behaviour test at real distances, with a throwaway office, session and device, inside
//      a transaction that is ALWAYS rolled back.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0060-punch-gps-accuracy-allowance.mjs

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
const migrations = path.join(__dirname, '..', '..', 'supabase', 'migrations')
const sql0060 = fs.readFileSync(path.join(migrations, '0060_punch_gps_accuracy_allowance.sql'), 'utf8')
const sql0038 = fs.readFileSync(path.join(migrations, '0038_punch_device_binding.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['haversine_m', 'nearest_active_site', 'employee_login', 'admin_reset_punch_device', 'log_audit', 'employee_log_location']

const bodyOf = text => {
  const first = text.indexOf('$function$')
  const second = text.indexOf('$function$', first + 10)
  return text.slice(first + 10, second)
}
const norm = s => s.replace(/\s+/g, ' ').trim()

async function liveDef(client) {
  const { rows } = await client.query(`select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'employee_punch'`)
  if (rows.length !== 1) throw new Error(`expected exactly one employee_punch, found ${rows.length}`)
  return rows[0].def
}
async function fnHashes(client, names) {
  const { rows } = await client.query(`select p.proname, md5(pg_get_functiondef(p.oid)) as hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[])`, [names])
  return Object.fromEntries(rows.map(r => [r.proname, r.hash]))
}

let failed = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: sites } = await client.query(`select name, radius_m, active from sites order by name`)
    console.log('Office radii right now:'); console.table(sites)

    // 1. Is production still what the repo says?
    const before = await liveDef(client)
    const repo0038 = bodyOf(sql0038.slice(sql0038.indexOf('create or replace function public.employee_punch(')))
    const liveMatchesRepo = norm(bodyOf(before)) === norm(repo0038)
    check('LIVE employee_punch matches migration 0038 (no hidden drift)', liveMatchesRepo)
    if (!liveMatchesRepo) {
      console.error('\nStopping: production differs from the repo. Not applying — investigate with pg_get_functiondef first.')
      process.exit(1)
    }

    const hashesBefore = await fnHashes(client, MUST_BE_UNCHANGED)
    await client.query(sql0060)
    console.log('\nMigration 0060 applied.\n')
    const hashesAfter = await fnHashes(client, MUST_BE_UNCHANGED)
    for (const n of MUST_BE_UNCHANGED) check(`${n} untouched`, hashesBefore[n] === hashesAfter[n])

    // 2. The live function now equals the repo's 0060 body, which is 0038 + only the radius check.
    const after = await liveDef(client)
    const repo0060 = bodyOf(sql0060.slice(sql0060.indexOf('create or replace function public.employee_punch(')))
    check('after: live employee_punch equals the 0060 file (0038 + only the radius check)', norm(bodyOf(after)) === norm(repo0060))
    const { rows: sigs } = await client.query(`select pg_get_function_identity_arguments(p.oid) as args, has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='employee_punch'`)
    check('still exactly one employee_punch, same 4 arguments, callable by anon', sigs.length === 1 && sigs[0].anon_can && sigs[0].args.split(',').length === 4, JSON.stringify(sigs))

    // 3. Behaviour at real distances.
    console.log('\nBehaviour test (rolled back afterwards):')
    const allowanceBefore = (await client.query(`select count(*)::int as n from audit_logs where action = 'PUNCH_GPS_ALLOWANCE'`)).rows[0].n
    const { rows: emps } = await client.query(`select id from employees where active limit 1`)
    const empId = emps[0].id
    await client.query('begin')
    try {
      await client.query(`update employees set punch_device_id = null, punch_device_bound_at = null where id = $1`, [empId])
      const { rows: s } = await client.query(`insert into sites (name, latitude, longitude, radius_m, active) values ('ZZ-test-office', 20.000000, 70.000000, 50, true) returning id`)
      const siteId = s[0].id
      const { rows: t } = await client.query(`insert into employee_sessions (emp_id) values ($1) returning token`, [empId])
      const token = t[0].token
      const { rows: today } = await client.query(`select (now() at time zone 'Asia/Kolkata')::date as d`)

      // north offsets from the office point: 0.0002° ≈ 22 m, 0.0005° ≈ 56 m, 0.0009° ≈ 100 m, 0.0012° ≈ 133 m
      const punch = async (type, dLat, accuracy) => {
        await client.query('savepoint s')
        if (type === 'in') await client.query(`delete from attendance where emp_id = $1 and date = $2`, [empId, today[0].d])
        const data = { punch_type: type, [`${type}_lat`]: 20 + dLat, [`${type}_lon`]: 70, [`${type}_site_id`]: siteId, [`${type}_location`]: 'test', status: 'Present' }
        if (accuracy != null) data[`${type}_accuracy_m`] = accuracy
        try {
          await client.query(`select employee_punch($1, $2, $3::jsonb, null)`, [token, empId, JSON.stringify(data)])
          await client.query('release savepoint s')
          return { ok: true }
        } catch (e) {
          await client.query('rollback to savepoint s')
          return { ok: false, msg: e.message }
        }
      }
      const allowanceRows = async () => (await client.query(`select count(*)::int as n from audit_logs where action = 'PUNCH_GPS_ALLOWANCE'`)).rows[0].n
      const baseline = await allowanceRows()

      let r = await punch('in', 0.0002, 5)
      check('22 m from a 50 m office: accepted (plain inside)', r.ok, r.msg)
      check('...and NOT flagged as allowance-accepted', (await allowanceRows()) === baseline)

      r = await punch('in', 0.0005, 5)
      check('56 m away with a sharp GPS fix (±5 m): still rejected', !r.ok && /Outside ZZ-test-office radius/.test(r.msg), r.msg)

      r = await punch('in', 0.0005, 20)
      check('56 m away with a ±20 m GPS fix: accepted on allowance', r.ok, r.msg)
      check('...and recorded as PUNCH_GPS_ALLOWANCE', (await allowanceRows()) === baseline + 1)

      r = await punch('in', 0.0009, 500)
      check('100 m away with a very weak fix (±500 m): accepted but allowance capped at 60 (limit 110 m)', r.ok, r.msg)

      r = await punch('in', 0.0012, 500)
      check('133 m away with a ±500 m fix: REJECTED — the 60 m cap holds', !r.ok && /plus 60m allowance/.test(r.msg), r.msg)

      r = await punch('in', 0.0005, null)
      check('56 m away with NO accuracy reported: rejected (no allowance without a number)', !r.ok, r.msg)

      // punch OUT path (uses out_accuracy_m): needs an earlier punch-in at least 5 min old
      await client.query(`delete from attendance where emp_id = $1 and date = $2`, [empId, today[0].d])
      await client.query(`insert into attendance (emp_id, date, in_time) values ($1, $2, (now() at time zone 'Asia/Kolkata')::time - interval '30 minutes')`, [empId, today[0].d])
      r = await punch('out', 0.0005, 20)
      check('punch OUT 56 m away with ±20 m: accepted on allowance', r.ok, r.msg)
      await client.query(`update attendance set out_time = null where emp_id = $1 and date = $2`, [empId, today[0].d])
      await client.query(`update attendance set updated_at = now() - interval '5 minutes' where emp_id = $1 and date = $2`, [empId, today[0].d])
      r = await punch('out', 0.0012, 500)
      check('punch OUT 133 m away with ±500 m: rejected', !r.ok, r.msg)
    } finally {
      await client.query('rollback')
    }
    const { rows: leftover } = await client.query(`select (select count(*) from sites where name = 'ZZ-test-office')::int as sites, (select count(*) from audit_logs where action = 'PUNCH_GPS_ALLOWANCE')::int as audits`)
    check('test rolled back (no test office left, no allowance audit rows from the test)', leftover[0].sites === 0 && leftover[0].audits === allowanceBefore, JSON.stringify(leftover[0]))
  } finally {
    await client.end()
  }
  console.log(failed ? `\n${failed} CHECK(S) FAILED.` : '\nAll checks passed.')
  process.exit(failed ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
