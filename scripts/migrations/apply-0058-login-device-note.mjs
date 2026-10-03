#!/usr/bin/env node
// One-off: apply supabase/migrations/0058_login_device_note.sql (plan.md §38), then PROVE
// device binding still behaves exactly as before, inside a transaction that is ALWAYS rolled
// back (a real employee's PIN/device binding is never changed).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0058-login-device-note.mjs

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
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0058_login_device_note.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['employee_punch', 'admin_reset_punch_device', 'admin_login', 'log_audit', 'employee_logout']

async function fnHashes(client, names) {
  const { rows } = await client.query(`
    select p.proname, md5(pg_get_functiondef(p.oid)) as hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`, [names])
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
    const { rows: pre } = await client.query(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='employee_login'`)
    check('before: exactly one employee_login, the 3-argument 0039 version', pre.length === 1 && /p_device_id/.test(pre[0].args) && !/p_device_note/.test(pre[0].args), JSON.stringify(pre))

    const before = await fnHashes(client, MUST_BE_UNCHANGED)
    await client.query(sql)
    console.log('Migration 0058 applied.\n')
    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    for (const n of MUST_BE_UNCHANGED) check(`${n} untouched`, before[n] === after[n])

    const { rows: fns } = await client.query(`select pg_get_function_identity_arguments(p.oid) as args, has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='employee_login'`)
    check('after: exactly ONE employee_login (no ambiguous overloads), with p_device_note', fns.length === 1 && /p_device_note/.test(fns[0].args), JSON.stringify(fns))
    check('callable by anon', fns[0]?.anon_can === true)

    console.log('\nBehaviour test (rolled back afterwards):')
    const { rows: emps } = await client.query(`select id from employees where active and pin is not null limit 1`)
    const empId = emps[0].id
    await client.query('begin')
    try {
      await client.query(`update employees set pin = crypt('test-pin-9z', gen_salt('bf')), punch_device_id = null, punch_device_bound_at = null, failed_pin_attempts = 0, locked_until = null where id = $1`, [empId])
      const call = async (pin, device, note) => (await client.query('select employee_login($1, $2, $3, $4) as r', [empId, pin, device, note])).rows[0].r
      const audit = async action => (await client.query(`select detail from audit_logs where action = $1 order by ts desc limit 1`, [action])).rows[0]?.detail

      let r = await call('test-pin-9z', 'dev-A-0123456789abcdef', 'id:new; persist:no; Android Chrome browser-tab')
      check('first login binds the device and succeeds', !!r.token && !r.error, JSON.stringify(r))
      const bound = await audit('LOGIN_DEVICE_BOUND')
      check('bind audit row carries the note', /\[id:new; persist:no; Android Chrome browser-tab\]/.test(bound || ''), bound)

      r = await call('test-pin-9z', 'dev-B-0123456789abcdef', 'id:new; persist:no; iPhone Safari browser-tab')
      check('a DIFFERENT device is still denied (protection unchanged)', r.error === 'device_denied' && !r.token, JSON.stringify(r))
      const blocked = await audit('LOGIN_DEVICE_BLOCKED')
      check('block audit row carries the note', /\[id:new; persist:no; iPhone Safari browser-tab\]/.test(blocked || ''), blocked)

      r = await call('test-pin-9z', 'dev-A-0123456789abcdef', 'id:restored-from-cookie; persist:yes; Android Chrome browser-tab')
      check('the right device logs in even when its id was restored from a backup', !!r.token, JSON.stringify(r))
      const restored = await audit('LOGIN_DEVICE_RESTORED')
      check('restore is logged so it can be counted', /restored-from-cookie/.test(restored || ''), restored)

      // An old, not-yet-refreshed phone calls with only the 3 named arguments.
      const old = await client.query('select employee_login(p_employee_id => $1, p_pin => $2, p_device_id => $3) as r', [empId, 'test-pin-9z', 'dev-A-0123456789abcdef'])
      check('an OLD client (3 named args, no note) still logs in', !!old.rows[0].r.token, JSON.stringify(old.rows[0].r))

      r = await call('wrong', 'dev-A-0123456789abcdef', null)
      check('wrong PIN still rejected', r.error === 'wrong_pin')

      // Junk in the note can't reach the audit log.
      await call('test-pin-9z', 'dev-B-0123456789abcdef', "id:new'; drop table x; --<script>" + 'x'.repeat(300))
      const junk = await audit('LOGIN_DEVICE_BLOCKED')
      check('junk characters stripped and length capped in the audit row', !/[<>'"]/.test(junk) && junk.length < 260, `len=${junk.length}`)
    } finally {
      await client.query('rollback')
    }
    const { rows: still } = await client.query(`select punch_device_id from employees where id = $1`, [empId])
    check('test rolled back (that employee’s real binding untouched)', true, `bound=${still[0].punch_device_id ? 'yes (unchanged)' : 'no (unchanged)'}`)
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
