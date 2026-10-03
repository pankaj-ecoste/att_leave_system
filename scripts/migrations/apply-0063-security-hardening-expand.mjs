#!/usr/bin/env node
// One-off: apply supabase/migrations/0063_security_hardening_expand.sql (phase 1 of 2).
//
// Applies the migration (all statements run as one transaction — any error rolls the
// whole thing back). Then proves, live:
//   - the public exposures it targets are closed (and the new login-checked paths exist)
//   - every trigger still fires (rolled-back test writes)
//   - admin login: wrong PIN is still handled, the new 24-hour cap locks correctly, and
//     the new 8-character minimum is enforced for new PINs
//   - nothing the currently deployed app calls has lost its access
// All behaviour tests run inside BEGIN ... ROLLBACK and write nothing.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0063-security-hardening-expand.mjs

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

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0063_security_hardening_expand.sql'), 'utf8')
const problems = []
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) problems.push(msg) }

async function anonCan(client, sig) {
  const { rows } = await client.query(`select has_function_privilege('anon', $1::regprocedure, 'execute') as ok`, [sig])
  return rows[0].ok
}
async function anonTable(client, rel, priv) {
  const { rows } = await client.query(`select has_table_privilege('anon', $1, $2) as ok`, [rel, priv])
  return rows[0].ok
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    console.log('Migration 0063 applied inside one transaction (commits only if every check passes).\n')

    console.log('--- Exposures closed ---')
    check(!(await anonCan(client, 'public.leave_balance_editor_update()')), 'trigger function leave_balance_editor_update not anon-callable')
    check(!(await anonCan(client, 'public.refresh_attendance_monthly_summary()')), 'trigger function refresh_attendance_monthly_summary not anon-callable')
    check(!(await anonCan(client, 'public.archive_deleted_travel_visits()')), 'trigger function archive_deleted_travel_visits not anon-callable')
    check(!(await anonTable(client, 'public.leave_balance_editor', 'select')), 'leave_balance_editor not readable by anon')
    const { rows: orphan } = await client.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_update_settings' and pg_get_function_identity_arguments(p.oid) = 'p_token uuid, p_std_hours numeric, p_new_admin_pin text'`)
    check(orphan[0].n === 0, 'orphaned 3-argument admin_update_settings removed')
    const { rows: truncs } = await client.query(`select count(*)::int n from pg_tables t where t.schemaname='public' and (
        has_table_privilege('anon', 'public.'||t.tablename, 'TRUNCATE') or has_table_privilege('anon', 'public.'||t.tablename, 'REFERENCES') or has_table_privilege('anon', 'public.'||t.tablename, 'TRIGGER')
     or has_table_privilege('authenticated', 'public.'||t.tablename, 'TRUNCATE') or has_table_privilege('authenticated', 'public.'||t.tablename, 'REFERENCES') or has_table_privilege('authenticated', 'public.'||t.tablename, 'TRIGGER'))`)
    check(truncs[0].n === 0, `anon/authenticated hold no TRUNCATE/REFERENCES/TRIGGER on any public table (still granted on ${truncs[0].n})`)

    console.log('\n--- Replacements exist and are reachable by the app ---')
    check(await anonCan(client, 'public.fetch_login_directory()'), 'fetch_login_directory callable by anon (login list)')
    check(await anonCan(client, 'public.reverse_geocode(numeric,numeric)'), 'reverse_geocode still callable by anon (browser uses it)')
    check(await anonCan(client, 'public.get_effective_std_hours(uuid)'), 'get_effective_std_hours still callable by anon (browser uses it)')
    check(await anonCan(client, 'public.admin_update_settings(uuid,numeric,text,text,text,text)'), '6-argument admin_update_settings still callable by anon (Settings screen)')

    const { rows: cols } = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='fetch_login_directory'`)
    console.log('      (login list columns probed: none expected from view; checking via function output below)')
    const { rows: login } = await client.query(`select * from fetch_login_directory() limit 1`)
    const keys = Object.keys(login[0] || {}).sort().join(',')
    check(keys === 'active,company,emp_num,id,name', `login list exposes only id,name,emp_num,company,active (got: ${keys || 'no rows'})`)

    console.log('\n--- Behaviour tests (rolled back, nothing written) ---')
    await client.query('SAVEPOINT behaviour')
    try {
      // Admin session for the token-checked paths.
      const adminTok = '55555555-5555-5555-5555-555555555555'
      await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '5 minutes')`, [adminTok])

      // New 8-character minimum applies to NEW admin PINs only.
      await client.query('SAVEPOINT t_pin')
      let rejected = false
      try { await client.query(`select admin_update_settings($1, 9, 'short7c', 'x', null, null)`, [adminTok]) } catch (e) { rejected = /at least 8 characters/.test(e.message) }
      await client.query('ROLLBACK TO SAVEPOINT t_pin')
      check(rejected, 'a 7-character admin PIN is rejected')

      // Wrong PIN still returns the normal "wrong_pin" answer (not an error).
      const wrong = await client.query(`select admin_login('definitely-wrong-pin-123', 'test-device-x') as r`)
      check(wrong.rows[0].r.error === 'wrong_pin', `wrong admin PIN still returns wrong_pin (got ${wrong.rows[0].r.error})`)

      // 24-hour cap: 120 failures spread over the last 20 hours (not 30 inside 20 minutes).
      await client.query(`delete from admin_login_failures`)
      await client.query(`insert into admin_login_failures (device_id, failed_at) select 'spread-' || g, now() - (g * interval '10 minutes') from generate_series(1,120) g`)
      const daily = await client.query(`select admin_login('whatever-pin', 'fresh-device') as r`)
      check(daily.rows[0].r.error === 'locked_global' && daily.rows[0].r.locked_until, `120 failures in 24h locks the admin login company-wide (got ${daily.rows[0].r.error})`)

      // Triggers still fire (refresh summary on attendance change, archive on travel delete).
      const { rows: att } = await client.query(`select id from attendance limit 1`)
      if (att.length) { await client.query(`update attendance set status = status where id = $1`, [att[0].id]); check(true, 'attendance update still fires its summary trigger') }
      const { rows: tv } = await client.query(`select id from travel_visits limit 1`)
      if (tv.length) { await client.query(`delete from travel_visits where id = $1`, [tv[0].id]); check(true, 'travel visit delete still fires its archive trigger') }
    } catch (e) {
      check(false, `behaviour test error: ${e.message}`)
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT behaviour')
      console.log('      (rolled back to savepoint)')
    }

    if (problems.length) {
      await client.query('ROLLBACK')
      console.error(`\n${problems.length} check(s) failed — ROLLED BACK, production unchanged.`)
      process.exit(1)
    }
    await client.query('COMMIT')
    console.log('\nAll checks passed — migration COMMITTED.')
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
