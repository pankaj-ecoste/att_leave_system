#!/usr/bin/env node
// plan.md §54 — apply supabase/migrations/0069_dropdown_options.sql.
//
// DEFAULT = DRY RUN: the migration and a walk-through run inside one transaction that is ROLLED BACK
// (any test employee / option / admin session disappears with it). Pass --apply to commit only the
// migration, after the same checks pass again.
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0069-dropdown-options.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0069_dropdown_options.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['admin_get_employees', 'admin_delete_employee', 'admin_set_employment_status', 'is_valid_admin_token', 'log_audit', 'employee_login']
const snap = async c => Object.fromEntries((await c.query(
  `select p.proname k, md5(pg_get_functiondef(p.oid)) h from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [MUST_BE_UNCHANGED])).rows.map(r => [r.k, r.h]))

let failures = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }
async function expectError(c, label, text, params, mustContain) {
  await c.query('savepoint s')
  try { await c.query(text, params); await c.query('rollback to savepoint s'); ok(false, label, 'expected an error but it succeeded') }
  catch (e) { await c.query('rollback to savepoint s'); ok(!mustContain || e.message.includes(mustContain), label, e.message) }
}

async function runChecks(c, before) {
  const after = await snap(c)
  for (const k of Object.keys(before)) ok(before[k] === after[k], `unchanged: ${k}`)

  const token = crypto.randomUUID()
  await c.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '1 hour')`, [token])
  const add = (kind, v) => c.query(`select * from admin_add_dropdown_option($1,$2,$3)`, [token, kind, v])

  // add / tidy / duplicate
  const { rows: [a] } = await add('job_title', '  Test   Operator ')
  ok(a.value === 'Test Operator', 'add tidies spaces', a.value)
  await expectError(c, 'case-only duplicate refused', `select * from admin_add_dropdown_option($1,'job_title','test operator')`, [token], 'already exists')
  await expectError(c, 'blank refused', `select * from admin_add_dropdown_option($1,'job_title','   ')`, [token], 'blank')
  await expectError(c, 'unknown list refused', `select * from admin_add_dropdown_option($1,'colour','x')`, [token], 'Unknown list')
  await expectError(c, 'bad admin token refused', `select * from admin_add_dropdown_option($1,'job_title','Zzz')`, [crypto.randomUUID()], 'Invalid')
  await add('department', 'Test Dept'); await add('business_unit', 'Test BU'); await add('location', 'Test Loc')

  // create: known passes, unknown blocked, blank allowed
  const mk = (extra) => c.query(`select * from admin_create_employee($1, $2::jsonb)`, [token, JSON.stringify({ name: 'ZZ Dropdown Test', pin: '4821', company: 'Asma Traexim Pvt Ltd', ...extra })])
  const { rows: [e1] } = await mk({ jobTitle: 'Test Operator', dept: 'Test Dept', bu: 'Test BU', locationInfo: 'Test Loc' })
  ok(e1.job_title === 'Test Operator' && e1.business_unit === 'Test BU', 'create with listed values works')
  await expectError(c, 'create with unknown job title blocked', `select * from admin_create_employee($1,$2::jsonb)`, [token, JSON.stringify({ name: 'ZZ x', pin: '4821', company: 'Asma Traexim Pvt Ltd', jobTitle: 'Operater' })], 'is not in the list')
  await expectError(c, 'create with unknown location blocked', `select * from admin_create_employee($1,$2::jsonb)`, [token, JSON.stringify({ name: 'ZZ x', pin: '4821', company: 'Asma Traexim Pvt Ltd', locationInfo: 'Nowhere' })], 'is not in the list')
  const { rows: [e2] } = await mk({})
  ok(e2.id && e2.job_title === null, 'create with all four blank is allowed (server)')

  // update: an old value that is NOT in the list survives unrelated edits; changing TO an unlisted value is blocked
  await c.query(`update employees set job_title = 'Legacy Title' where id = $1`, [e1.id])
  const upd = data => c.query(`select * from admin_update_employee($1,$2,$3::jsonb)`, [token, e1.id, JSON.stringify(data)])
  const { rows: [u1] } = await upd({ name: 'ZZ Renamed', jobTitle: 'Legacy Title' })
  ok(u1.name === 'ZZ Renamed' && u1.job_title === 'Legacy Title', 'update: unchanged legacy value passes')
  await expectError(c, 'update to an unlisted value blocked', `select * from admin_update_employee($1,$2,$3::jsonb)`, [token, e1.id, JSON.stringify({ jobTitle: 'Another Legacy' })], 'is not in the list')
  const { rows: [u2] } = await upd({ jobTitle: 'Test Operator' })
  ok(u2.job_title === 'Test Operator', 'update to a listed value works')
  const { rows: [u3] } = await upd({ jobTitle: null, dept: null })
  ok(u3.job_title === 'Test Operator', 'update with blank keeps the old value (coalesce, as before)')

  // remove: in use blocked, unused works
  await expectError(c, 'remove an option in use is blocked', `select admin_remove_dropdown_option($1,$2)`, [token, a.id], 'used by')
  await c.query(`update employees set job_title = null where id in ($1,$2)`, [e1.id, e2.id])
  const { rows: [rm] } = await c.query(`select admin_remove_dropdown_option($1,$2) r`, [token, a.id])
  ok(rm.r === true, 'remove an unused option works')
  const { rows: lst } = await c.query(`select * from admin_get_dropdown_options($1)`, [token])
  ok(lst.length === 3 && lst.every(r => Number(r.in_use) >= 0), 'list returns the remaining 3 with usage counts', String(lst.length))

  // access: anon can call the admin functions only; cannot read the table or the helpers
  const priv = async (q) => (await c.query(q)).rows[0].v
  ok(await priv(`select has_function_privilege('anon','admin_add_dropdown_option(uuid,text,text)','execute') v`), 'anon may call admin_add_dropdown_option (token-checked)')
  ok(!(await priv(`select has_table_privilege('anon','public.dropdown_options','select') v`)), 'anon cannot read the table directly')
  ok(!(await priv(`select has_function_privilege('anon','check_dropdown_value(text,text,text)','execute') v`)), 'anon cannot call the internal check helper')
  const { rows: vs } = await c.query(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname in ('admin_create_employee','admin_update_employee')`)
  ok(vs[0].n === 2, 'exactly one version each of create/update', String(vs[0].n))
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  await client.query('begin')
  await client.query(sql)
  await runChecks(client, before)
  if (APPLY && failures === 0) { await client.query('rollback'); await client.query('begin'); await client.query(sql); await client.query('commit'); console.log('\nCOMMITTED migration 0069.') }
  else { await client.query('rollback'); console.log(failures ? `\n${failures} check(s) FAILED — rolled back, nothing changed.` : '\nDRY RUN passed — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) { await client.query('rollback').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1 }
await client.end()
process.exitCode = process.exitCode || (failures ? 1 : 0)
