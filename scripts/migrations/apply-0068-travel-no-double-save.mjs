#!/usr/bin/env node
// plan.md §52 — apply supabase/migrations/0068_travel_no_double_save.sql.
//
// DEFAULT = DRY RUN: the migration and a walk-through run inside one transaction that is ROLLED
// BACK. Pass --apply to commit only the migration (after the same checks pass again).
// The walk-through only uses made-up photo paths (the near-duplicate guard may call the storage
// delete for them, which is a harmless no-op for files that do not exist).
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0068-travel-no-double-save.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0068_travel_no_double_save.sql'), 'utf8')

const MUST_BE_UNCHANGED = [
  'travel_summary_for_employee', 'travel_claim_totals', 'employee_submit_travel_claim', 'admin_mark_travel_claim_paid',
  'employee_delete_travel_expense', 'employee_get_travel_expenses', 'admin_get_employee_travel_expenses', 'manager_get_team_travel_expenses',
  'employee_get_own_travel_photo_url', 'manager_get_team_travel_photo_url', 'admin_get_travel_photo_url', 'travel_photo_is_orphaned',
  'employee_get_travel_journey', 'admin_get_employee_travel_journey', 'manager_get_team_travel_journey', 'admin_settle_travel_period',
  'employee_get_travel_summary', 'employee_get_travel_claims', 'admin_get_travel_claims', 'archive_deleted_travel_visits',
  'storage_sign_url_core', 'storage_delete_objects_core', 'log_audit', 'employee_punch', 'employee_login',
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
  for (const name of ['employee_add_travel_visit', 'employee_add_travel_expense']) {
    const { rows } = await client.query(
      `select has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [name])
    ok(rows.length === 1 && rows[0].anon === true, `exactly one ${name}, anon may call it`, `${rows.length} version(s)`)
  }

  // ---- setup: Himanshu, punched in today (rolled back with everything else) ----
  const { rows: [emp] } = await client.query(`select id from employees where name = 'Himanshu Bansal' and work_mode in ('field','both') limit 1`)
  const token = crypto.randomUUID()
  await client.query(`insert into employee_sessions (token, emp_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [token, emp.id])
  const today = (await client.query(`select (now() at time zone 'Asia/Kolkata')::date d`)).rows[0].d
  const { rows: att } = await client.query(`select 1 from attendance where emp_id = $1 and date = $2`, [emp.id, today])
  if (att.length) await client.query(`update attendance set in_time = coalesce(in_time, '09:00:00'), out_time = null, in_lat = 28.5, in_lon = 77.1 where emp_id = $1 and date = $2`, [emp.id, today])
  else await client.query(`insert into attendance (emp_id, date, in_time, in_lat, in_lon) values ($1, $2, '09:00:00', 28.5, 77.1)`, [emp.id, today])
  await client.query(`delete from travel_visits where emp_id = $1 and date = $2`, [emp.id, today]) // only inside this rolled-back transaction

  const fp = () => `dryrun-${crypto.randomUUID()}/p.jpg`
  const visit = (site, lat, lon, ticket) => client.query(
    `select * from employee_add_travel_visit($1,$2,$3,$4,$5,10,$6,$7,null,null,null,$8)`, [token, emp.id, today, lat, lon, site, fp(), ticket])
  const count = async () => (await client.query(`select count(*)::int n from travel_visits where emp_id = $1 and date = $2`, [emp.id, today])).rows[0].n

  // ---- same ticket ----
  const t1 = crypto.randomUUID()
  const a = (await visit('Site A', 28.6, 77.2, t1)).rows[0]
  const a2 = (await visit('Site A', 28.6, 77.2, t1)).rows[0]
  ok(a2.id === a.id && (await count()) === 1, 'same ticket twice → one visit, the second call returns the first')

  // ---- narrow safety net (no ticket, like an older screen) ----
  const dup = (await visit('site a ', 28.6001, 77.2001, null)).rows[0]
  ok(dup.id === a.id && (await count()) === 1, 'same site name (any case/spaces), ~15 m away, minutes later → treated as the same visit')
  const other = (await visit('Site B', 28.6, 77.2, null)).rows[0]
  ok(other.id !== a.id && (await count()) === 2, 'different site name at the same spot → allowed (two clients in one building)')
  const far = (await visit('Site A', 28.7, 77.3, null)).rows[0]
  ok(far.id !== a.id && (await count()) === 3, 'same site name but ~14 km away → allowed')
  await client.query(`update travel_visits set captured_at = now() - interval '11 minutes' where id = $1`, [far.id])
  const later = (await visit('Site A', 28.7, 77.3, null)).rows[0]
  ok(later.id !== far.id && (await count()) === 4, 'same site and spot but the earlier one is over 10 minutes old → allowed (a genuine return visit)')

  // ---- the distance is not measured twice ----
  const { rows: legs } = await client.query(`select leg_distance_km::float km from travel_visits where emp_id = $1 and date = $2 order by captured_at`, [emp.id, today])
  ok(legs.length === 4 && legs.filter(l => l.km > 1).length >= 1, 'legs measured normally for genuine visits', legs.map(l => l.km.toFixed(1)).join(' / '))

  // ---- the discarded attempt's own photo is not kept, a saved photo is never touched ----
  const keptPhoto = (await client.query(`select photo_path from travel_visits where id = $1`, [a.id])).rows[0].photo_path
  ok((await client.query(`select travel_photo_is_orphaned($1) o`, [keptPhoto])).rows[0].o === false, 'the saved visit\'s photo is still referenced (never dropped)')

  // ---- older call shape (11 arguments, no ticket) still works ----
  await client.query(`delete from travel_visits where emp_id = $1 and date = $2`, [emp.id, today])
  const old = (await client.query(`select * from employee_add_travel_visit($1,$2,$3,28.6,77.2,10,'Old screen',$4)`, [token, emp.id, today, fp()])).rows[0]
  ok(old.client_ticket === null, 'an older screen (no ticket sent) still saves a visit')

  // ---- expenses ----
  const e1 = crypto.randomUUID()
  const ex = () => client.query(`select * from employee_add_travel_expense($1,$2,'Toll',150,$3,null,null,null,null,$4)`, [token, emp.id, fp(), e1])
  const x1 = (await ex()).rows[0]
  const x2 = (await ex()).rows[0]
  ok(x1.id === x2.id, 'same expense ticket twice → one expense')
  const x3 = (await client.query(`select * from employee_add_travel_expense($1,$2,'Toll',150,$3,null,null,null,null,$4)`, [token, emp.id, fp(), crypto.randomUUID()])).rows[0]
  ok(x3.id !== x1.id, 'a genuine second expense (even same type and amount) is always allowed')
  await expectError(client, 'expense rules still enforced', `select * from employee_add_travel_expense($1,$2,'Other',50,$3,null,null,null,null,$4)`, [token, emp.id, fp(), crypto.randomUUID()], 'what this expense was for')
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await snap(client)
  const { rows: [pre] } = await client.query(`select (select count(*) from travel_visits)::int v, (select count(*) from travel_expenses)::int x`)

  await client.query('begin')
  await client.query(sql)
  console.log('Migration SQL ran (inside a transaction).\n')
  await runChecks(client, before)
  await client.query('rollback')
  if (failures) { console.log(`\n${failures} CHECK(S) FAILED — rolled back, nothing changed.`); process.exit(1) }
  console.log('\nAll checks passed.')
  if (!APPLY) { console.log('DRY RUN: rolled back — nothing changed. Re-run with --apply to commit the migration.'); process.exit(0) }

  await client.query('begin')
  await client.query(sql)
  const after = await snap(client)
  const bad = Object.keys(before).filter(k => before[k] !== after[k])
  const { rows: [post] } = await client.query(`select (select count(*) from travel_visits)::int v, (select count(*) from travel_expenses)::int x`)
  if (bad.length || post.v !== pre.v || post.x !== pre.x) { await client.query('rollback'); console.error('!! unexpected change, rolled back:', bad, pre, post); process.exit(1) }
  await client.query('commit')
  console.log(`Migration 0068 COMMITTED to production (${post.v} visits and ${post.x} expenses kept, none changed).`)
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('Aborted, rolled back:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
