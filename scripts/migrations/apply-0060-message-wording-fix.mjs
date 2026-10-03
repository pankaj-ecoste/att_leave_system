#!/usr/bin/env node
// One-off follow-up to apply-0060: the rejection message printed "...50ms." / "...accuracy)s."
// (a stray literal "s" after the % placeholder). Same function, wording only. Re-runs the
// corrected 0060 file after proving the live function is exactly the previous 0060 version
// with that one fragment different, then checks the message in a rolled-back test punch.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0060-message-wording-fix.mjs

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const connectionString = process.env.DATABASE_URL
if (!connectionString) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0060_punch_gps_accuracy_allowance.sql'), 'utf8')

const bodyOf = t => { const a = t.indexOf('$function$'); return t.slice(a + 10, t.indexOf('$function$', a + 10)) }
const norm = s => s.replace(/\s+/g, ' ').trim()
let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const get = async () => (await client.query(`select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='employee_punch'`)).rows[0].def
  const before = await get()
  const fileBody = bodyOf(sql.slice(sql.indexOf('create or replace function public.employee_punch(')))
  const expectedOld = norm(fileBody).replace('must be within %m%. Punch', 'must be within %m%s. Punch')
  check('live function is exactly the earlier 0060 version (only the message fragment differs)', norm(bodyOf(before)) === expectedOld)
  if (failed) process.exit(1)

  await client.query(sql)
  check('after: live equals the corrected 0060 file', norm(bodyOf(await get())) === norm(fileBody))

  const { rows: emps } = await client.query(`select id from employees where active limit 1`)
  await client.query('begin')
  try {
    await client.query(`update employees set punch_device_id = null where id = $1`, [emps[0].id])
    const { rows: s } = await client.query(`insert into sites (name, latitude, longitude, radius_m, active) values ('ZZ-test-office', 20, 70, 50, true) returning id`)
    const { rows: t } = await client.query(`insert into employee_sessions (emp_id) values ($1) returning token`, [emps[0].id])
    const tryPunch = async acc => {
      await client.query('savepoint s')
      const data = { punch_type: 'in', in_lat: 20.0012, in_lon: 70, in_site_id: s[0].id, in_location: 't', status: 'Present', ...(acc ? { in_accuracy_m: acc } : {}) }
      try { await client.query(`select employee_punch($1,$2,$3::jsonb,null)`, [t[0].token, emps[0].id, JSON.stringify(data)]) ; await client.query('release savepoint s'); return null }
      catch (e) { await client.query('rollback to savepoint s'); return e.message }
    }
    const withAllowance = await tryPunch(500)
    const noAllowance = await tryPunch(null)
    check('message with allowance reads cleanly', withAllowance === 'Outside ZZ-test-office radius — 133m away, must be within 50m (plus 60m allowance for GPS accuracy). Punch not recorded.', withAllowance)
    check('message without allowance reads cleanly', noAllowance === 'Outside ZZ-test-office radius — 133m away, must be within 50m. Punch not recorded.', noAllowance)
  } finally { await client.query('rollback') }
} finally { await client.end() }
console.log(failed ? `\n${failed} CHECK(S) FAILED.` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
