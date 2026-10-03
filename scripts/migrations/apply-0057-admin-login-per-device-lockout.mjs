#!/usr/bin/env node
// One-off: apply supabase/migrations/0057_admin_login_per_device_lockout.sql (plan.md §37),
// then PROVE the new lock behaves, using a throwaway PIN inside a transaction that is
// ALWAYS rolled back — the real admin PIN and the real failure table are never touched
// by the test.
//
// Run this BEFORE pushing the matching front-end: the new app calls admin_login(pin, device)
// and 0057 drops the old admin_login(pin).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0057-admin-login-per-device-lockout.mjs

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

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0057_admin_login_per_device_lockout.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['admin_logout', 'is_valid_admin_token', 'employee_login', 'log_audit', 'admin_update_settings']

async function fnHashes(client, names) {
  const { rows } = await client.query(`
    select p.proname, md5(pg_get_functiondef(p.oid)) as hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
  `, [names])
  return Object.fromEntries(rows.map(r => [r.proname, r.hash]))
}

let failed = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function login(client, pin, device) {
  const { rows } = await client.query('select admin_login($1, $2) as r', [pin, device])
  return rows[0].r
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const before = await fnHashes(client, MUST_BE_UNCHANGED)
    await client.query(sql)
    console.log('Migration 0057 applied.\n')
    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    for (const n of MUST_BE_UNCHANGED) check(`${n} untouched`, before[n] === after[n])

    const { rows: fns } = await client.query(`
      select pg_get_function_identity_arguments(p.oid) as args, has_function_privilege('anon', p.oid, 'execute') as anon_can
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_login'`)
    check('exactly one admin_login signature, (p_pin text, p_device_id text)', fns.length === 1 && /p_device_id/.test(fns[0].args), JSON.stringify(fns))
    check('admin_login callable by anon', fns[0]?.anon_can === true)
    const { rows: helper } = await client.query(`select has_function_privilege('anon', '_admin_login_unlock_at(text,int)', 'execute') as anon_can`)
    check('internal helper NOT callable by anon', helper[0].anon_can === false)
    const { rows: tbl } = await client.query(`
      select has_table_privilege('anon', 'admin_login_failures', 'select') as anon_read, relrowsecurity
      from pg_class where relname = 'admin_login_failures'`)
    check('failure table locked down (RLS on, anon cannot read)', tbl[0].relrowsecurity === true && tbl[0].anon_read === false)

    // ---- behaviour test: throwaway PIN, always rolled back ----
    console.log('\nBehaviour test (rolled back afterwards):')
    const { rows: rowsBefore } = await client.query('select count(*)::int as n from admin_login_failures')
    await client.query('begin')
    try {
      await client.query(`update app_settings set admin_pin_hash = crypt('test-pin-9z', gen_salt('bf')) where id = 1`)

      let r = await login(client, 'bad', 'dev-A')
      check('1st wrong PIN: wrong_pin, 2 tries left', r.error === 'wrong_pin' && r.tries_left === 2, JSON.stringify(r))
      r = await login(client, 'bad', 'dev-A')
      check('2nd wrong PIN: 1 try left', r.error === 'wrong_pin' && r.tries_left === 1, JSON.stringify(r))
      r = await login(client, 'bad', 'dev-A')
      check('3rd wrong PIN: device locked, with a time', r.error === 'locked' && !!r.locked_until, JSON.stringify(r))
      r = await login(client, 'test-pin-9z', 'dev-A')
      check('locked device is rejected even with the CORRECT PIN (hard block)', r.error === 'locked' && !r.token, JSON.stringify(r))
      r = await login(client, 'test-pin-9z', 'dev-B')
      check('a DIFFERENT device logs in fine while dev-A is locked  <-- the reported bug', !!r.token && !r.error, JSON.stringify(r))
      const { rows: cnt } = await client.query(`select count(*)::int as n from admin_login_failures where device_id = 'dev-A'`)
      check('attempts made while locked are not counted (lock cannot extend itself)', cnt[0].n === 3, `rows=${cnt[0].n}`)

      await login(client, 'bad', 'dev-C'); await login(client, 'bad', 'dev-C')
      r = await login(client, 'test-pin-9z', 'dev-C')
      check('correct PIN after 2 typos succeeds', !!r.token)
      const { rows: cleared } = await client.query(`select count(*)::int as n from admin_login_failures where device_id = 'dev-C'`)
      check('...and forgives that device\'s earlier typos', cleared[0].n === 0)

      // company-wide cap: 30 failures from 30 different devices (dev-A already has 3)
      let last
      for (let i = 0; i < 30; i++) last = await login(client, 'bad', `spray-${i}`)
      // dev-A's 3 + 30 sprays: global limit (30) is reached before the 30th spray lands
      check('company-wide cap trips under a device-rotating guesser', last.error === 'locked_global' || last.error === 'locked', JSON.stringify(last))
      r = await login(client, 'test-pin-9z', 'brand-new-device')
      check('while globally locked, even a brand-new device with the right PIN is rejected', r.error === 'locked_global' && !r.token, JSON.stringify(r))
      const { rows: audit } = await client.query(`select action from audit_logs where action like 'ADMIN_LOGIN%' order by ts`)
      check('lock events were written to the audit log', audit.some(a => a.action === 'ADMIN_LOGIN_LOCKED') && audit.some(a => a.action === 'ADMIN_LOGIN_GLOBAL_LOCK'), audit.map(a => a.action).join(','))
    } finally {
      await client.query('rollback')
    }

    const { rows: leftover } = await client.query('select count(*)::int as n from admin_login_failures')
    check('test left no rows behind (rolled back)', leftover[0].n === rowsBefore[0].n, `rows=${leftover[0].n}`)
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
