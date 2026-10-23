#!/usr/bin/env node
// plan.md §49 — apply supabase/migrations/0067_travel_expense_description.sql.
//
// DEFAULT = DRY RUN: the migration and a walk-through run inside one transaction that is ROLLED
// BACK. Pass --apply to commit only the migration (after the same checks pass again).
// Nothing here touches storage or real photos.
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0067-travel-expense-description.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0067_travel_expense_description.sql'), 'utf8')

const MUST_BE_UNCHANGED = [
  'travel_summary_for_employee', 'travel_claim_totals', 'employee_submit_travel_claim', 'admin_mark_travel_claim_paid',
  'employee_delete_travel_expense', 'employee_get_travel_expenses', 'admin_get_employee_travel_expenses', 'manager_get_team_travel_expenses',
  'employee_get_own_travel_photo_url', 'manager_get_team_travel_photo_url', 'admin_get_travel_photo_url', 'travel_photo_is_orphaned',
  'employee_add_travel_visit', 'admin_settle_travel_period', 'employee_get_travel_summary', 'storage_sign_url_core',
  'storage_delete_objects_core', 'log_audit', 'employee_punch', 'employee_login',
]
const snap = async c => Object.fromEntries((await c.query(
  `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' k, md5(pg_get_functiondef(p.oid)) h
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[])`, [MUST_BE_UNCHANGED])).rows.map(r => [r.k, r.h]))

let failures = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }
async function expectError(c, label, text, params, mustContain) {
  await c.query('savepoint s')
  try {
    await c.query(text, params)
    await c.query('rollback to savepoint s')
    ok(false, label, 'expected an error but it succeeded')
  } catch (e) {
    await c.query('rollback to savepoint s')
    ok(!mustContain || e.message.includes(mustContain), label, e.message)
  }
}

async function runChecks(client, before) {
  const after = await snap(client)
  for (const k of Object.keys(before)) ok(before[k] === after[k], `unchanged: ${k}`)
  const { rows: ov } = await client.query(
    `select pg_get_function_identity_arguments(p.oid) a, has_function_privilege('anon', p.oid, 'execute') anon
       from pg_proc p where p.proname = 'employee_add_travel_expense' and p.pronamespace = 'public'::regnamespace`)
  ok(ov.length === 1 && ov[0].anon === true, 'exactly one employee_add_travel_expense exists, anon may call it', `${ov.length} version(s)`)

  const { rows: [emp] } = await client.query(`select id from employees where name = 'Himanshu Bansal' and work_mode in ('field','both') limit 1`)
  const token = crypto.randomUUID()
  await client.query(`insert into employee_sessions (token, emp_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [token, emp.id])
  const today = (await client.query(`select (now() at time zone 'Asia/Kolkata')::date d`)).rows[0].d
  const { rows: att } = await client.query(`select 1 from attendance where emp_id = $1 and date = $2`, [emp.id, today])
  if (att.length) await client.query(`update attendance set in_time = coalesce(in_time, '09:00:00'), out_time = null where emp_id = $1 and date = $2`, [emp.id, today])
  else await client.query(`insert into attendance (emp_id, date, in_time) values ($1, $2, '09:00:00')`, [emp.id, today])

  const fp = () => `dryrun-${crypto.randomUUID()}/receipt.jpg`
  const full = (cat, desc) => [`select * from employee_add_travel_expense($1,$2,$3,$4,$5,null,null,null,$6)`, [token, emp.id, cat, 100, fp(), desc]]

  await expectError(client, 'Other with no description is rejected', ...full('Other', null), 'what this expense was for')
  await expectError(client, 'Other with only spaces is rejected', ...full('Other', '   '), 'what this expense was for')
  await expectError(client, 'description over 100 characters is rejected', ...full('Other', 'x'.repeat(101)), 'too long')
  const o = (await client.query(...full('Other', '  tyre repair  '))).rows[0]
  ok(o.description === 'tyre repair' && o.category === 'Other', 'Other + description saved (trimmed)', o.description)
  const t = (await client.query(...full('Toll', 'ignored text'))).rows[0]
  ok(t.description === null, 'Toll never keeps a description')
  // an older app screen sends only the first five arguments
  const old = (await client.query(`select * from employee_add_travel_expense($1,$2,'Lunch',80,$3)`, [token, emp.id, fp()])).rows[0]
  ok(old.category === 'Lunch' && old.description === null, 'older app screen (no description sent) still works for Lunch')
  await expectError(client, 'older app screen cannot save an Other without text', `select * from employee_add_travel_expense($1,$2,'Other',80,$3)`, [token, emp.id, fp()], 'what this expense was for')
  const list = (await client.query(`select * from employee_get_travel_expenses($1,$2)`, [token, emp.id])).rows
  ok(list.some(r => r.description === 'tyre repair'), 'staff read returns the description')
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  const { rows: [pre] } = await client.query(`select count(*)::int n from travel_expenses`)

  await client.query('begin')
  await client.query(sql)
  console.log('Migration SQL ran (inside a transaction).\n')
  const { rows: [col] } = await client.query(`select count(*)::int n from travel_expenses where description is not null`)
  ok(col.n === 0, 'existing expenses are untouched (no description set on any)')
  await runChecks(client, before)
  await client.query('rollback')
  if (failures) { console.log(`\n${failures} CHECK(S) FAILED — rolled back, nothing changed.`); process.exit(1) }
  console.log('\nAll checks passed.')
  if (!APPLY) { console.log('DRY RUN: rolled back — nothing changed. Re-run with --apply to commit the migration.'); process.exit(0) }

  await client.query('begin')
  await client.query(sql)
  const after = await snap(client)
  const bad = Object.keys(before).filter(k => before[k] !== after[k])
  const { rows: [post] } = await client.query(`select count(*)::int n from travel_expenses`)
  if (bad.length || post.n !== pre.n) { await client.query('rollback'); console.error('!! unexpected change, rolled back:', bad, pre.n, post.n); process.exit(1) }
  await client.query('commit')
  console.log(`Migration 0067 COMMITTED to production (${post.n} existing expense row(s) kept).`)
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('Aborted, rolled back:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
