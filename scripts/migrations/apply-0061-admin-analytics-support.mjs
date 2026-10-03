#!/usr/bin/env node
// One-off: apply supabase/migrations/0061_admin_analytics_support.sql (plan.md §45), then PROVE it,
// using throwaway rows inside a transaction that is ALWAYS rolled back:
//   * the analytics km equals what the existing travel_summary_for_employee reports (so the two
//     definitions of "km" agree);
//   * after a settlement-style delete of the visits, the numbers are unchanged (the archive works);
//   * device-reset counts count only the right audit rows, and the month filter works;
//   * a bad admin token is refused.
// No real visit, audit or archive row is changed.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0061-admin-analytics-support.mjs

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
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0061_admin_analytics_support.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['travel_summary_for_employee', 'admin_settle_travel_period', 'employee_add_travel_visit', 'admin_get_travel_overview', 'log_audit', 'is_valid_admin_token']

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
    const before = await fnHashes(client, MUST_BE_UNCHANGED)
    await client.query(sql)
    console.log('Migration 0061 applied.\n')
    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    for (const n of MUST_BE_UNCHANGED) check(`${n} untouched (the money-handling travel functions are not modified)`, before[n] === after[n])

    const { rows: grants } = await client.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_get_travel_analytics','admin_get_device_reset_counts')`)
    check('both new functions exist and are callable (token-checked inside)', grants.length === 2 && grants.every(g => g.anon_can), JSON.stringify(grants))
    const { rows: tbl } = await client.query(`select has_table_privilege('anon', 'travel_daily_archive', 'select') as anon_read, relrowsecurity from pg_class where relname = 'travel_daily_archive'`)
    check('archive table locked down (RLS on, anon cannot read)', tbl[0].relrowsecurity === true && tbl[0].anon_read === false)
    const { rows: trg } = await client.query(`select count(*)::int as n from pg_trigger where tgname = 'trg_archive_deleted_travel_visits' and not tgisinternal`)
    check('delete trigger installed on travel_visits', trg[0].n === 1)

    console.log('\nBehaviour test (rolled back afterwards):')
    const { rows: emps } = await client.query(`select e.id from employees e where e.active and e.deleted_at is null and not exists (select 1 from travel_visits v where v.emp_id = e.id) limit 2`)
    if (emps.length < 2) throw new Error('Need two active employees with no live travel visits to test with')
    const [E, F] = [emps[0].id, emps[1].id]
    const { rows: [{ n: archiveRowsBefore }] } = await client.query(`select count(*)::int as n from travel_daily_archive`)

    await client.query('begin')
    try {
      const { rows: [{ token }] } = await client.query(`insert into admin_sessions (token, expires_at) values (gen_random_uuid(), now() + interval '1 hour') returning token`)
      const D = '2030-01-15'
      await client.query(`insert into attendance (emp_id, date, day_type, in_time, out_time, out_lat, out_lon) values ($1, $2, 'working', '09:00', '19:00', 28.70, 77.25)`, [E, D])
      const visits = [[28.60, 77.20, 2.0, '2030-01-15 05:00+00'], [28.61, 77.21, 3.5, '2030-01-15 07:00+00'], [28.62, 77.22, 1.0, '2030-01-15 09:00+00']]
      for (const [lat, lon, leg, at] of visits) {
        await client.query(`insert into travel_visits (emp_id, date, captured_at, lat, lon, site_note, photo_path, leg_distance_km) values ($1, $2, $3, $4, $5, 'test', 'test/path', $6)`, [E, D, at, lat, lon, leg])
      }
      const analytics = async () => {
        const { rows } = await client.query(`select admin_get_travel_analytics($1, '2030-01-01', '2030-01-31') as r`, [token])
        return rows[0].r.find(x => x.empId === E)
      }

      const { rows: [{ total_km }] } = await client.query(`select total_km from travel_summary_for_employee($1)`, [E])
      const live = await analytics()
      check('live: 3 visits, busiest day = 3 on that date', live?.visits === 3 && live?.bestDayVisits === 3 && live?.bestDayDate === D, JSON.stringify(live))
      check('live: analytics km equals the existing travel summary km (both definitions agree)', live && Math.abs(Number(live.km) - Number(total_km)) < 0.01, `analytics=${live?.km} summary=${Number(total_km).toFixed(2)}`)

      // What settlement does: delete every visit of the employee.
      await client.query(`delete from travel_visits where emp_id = $1`, [E])
      const { rows: [{ n: liveLeft }] } = await client.query(`select count(*)::int as n from travel_visits where emp_id = $1`, [E])
      const archived = await analytics()
      check('settlement-style delete removed the live visits', liveLeft === 0)
      check('after delete: the SAME visits, km and busiest day are still reported (from the archive)',
        archived && archived.visits === live.visits && Math.abs(Number(archived.km) - Number(live.km)) < 0.01 && archived.bestDayVisits === 3, JSON.stringify(archived))

      const other = (await client.query(`select admin_get_travel_analytics($1, '2030-01-01', '2030-01-31') as r`, [token])).rows[0].r.find(x => x.empId === F)
      check('another employee with no travel does not appear', other === undefined)
      const outOfRange = (await client.query(`select admin_get_travel_analytics($1, '2030-02-01', '2030-02-28') as r`, [token])).rows[0].r.find(x => x.empId === E)
      check('a different month does not include it', outOfRange === undefined)

      // device resets
      await client.query(`insert into audit_logs (action, detail, by_name, ts) values ('PUNCH_DEVICE_RESET', 'ZZ Test Person — registered punch device reset', 'admin', now()), ('PUNCH_DEVICE_RESET', 'ZZ Test Person — registered punch device reset', 'admin', now()), ('PUNCH_DEVICE_RESET', 'ZZ Test Person — registered punch device reset', 'admin', now() - interval '60 days'), ('PUNCH_DEVICE_BOUND', 'ZZ Test Person — punch device registered', 'system', now())`)
      const { rows: [{ r: resets }] } = await client.query(`select admin_get_device_reset_counts($1, (now() at time zone 'Asia/Kolkata')::date - 5, (now() at time zone 'Asia/Kolkata')::date + 5) as r`, [token])
      const zz = resets.find(x => x.name === 'ZZ Test Person')
      check('device resets: 2 in range, 3 in total, other audit actions not counted', zz?.inRange === 2 && zz?.total === 3, JSON.stringify(zz))

      let refused = false
      try { await client.query('savepoint s'); await client.query(`select admin_get_travel_analytics('00000000-0000-0000-0000-000000000000', '2030-01-01', '2030-01-31')`) } catch (e) { refused = /Invalid admin session/.test(e.message); await client.query('rollback to savepoint s') }
      check('a wrong admin token is refused (travel)', refused)
      refused = false
      try { await client.query('savepoint s2'); await client.query(`select admin_get_device_reset_counts('00000000-0000-0000-0000-000000000000', '2030-01-01', '2030-01-31')`) } catch (e) { refused = /Invalid admin session/.test(e.message); await client.query('rollback to savepoint s2') }
      check('a wrong admin token is refused (device resets)', refused)
    } finally {
      await client.query('rollback')
    }
    const { rows: [{ n: archiveRowsAfter }] } = await client.query(`select count(*)::int as n from travel_daily_archive`)
    check('test rolled back (no archive rows left behind)', archiveRowsAfter === archiveRowsBefore, `${archiveRowsBefore} -> ${archiveRowsAfter}`)
  } finally {
    await client.end()
  }
  console.log(failed ? `\n${failed} CHECK(S) FAILED — do not push the front-end.` : '\nAll checks passed. Safe to push the matching front-end.')
  process.exit(failed ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
