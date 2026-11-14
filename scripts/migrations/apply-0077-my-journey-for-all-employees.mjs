#!/usr/bin/env node
// plan.md §63 — migration 0077: My Journey for ALL employees.
// Default run = DRY RUN: proves each of the 5 live functions == its latest repo version, installs 0077 inside a
// transaction, runs every test (token checks are stubbed INSIDE the transaction only), then ROLLS EVERYTHING BACK.
// With --apply: same checks, and only if every test passed, installs 0077 for real (functions only; no data touched).
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0077-my-journey-for-all-employees.mjs [--apply]

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations')
const connectionString = process.env.DATABASE_URL
const APPLY = process.argv.includes('--apply')
if (!connectionString) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const sql = fs.readFileSync(path.join(MIG, '0077_my_journey_for_all_employees.sql'), 'utf8')
const norm = s => s.replace(/\s+/g, ' ').trim()
const bodyFromFile = (file, name) => {
  const m = fs.readFileSync(path.join(MIG, file), 'utf8').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, 'i'))
  if (!m) throw new Error(`no ${name} in ${file}`)
  return norm(m[1])
}
const LATEST = {
  employee_add_travel_visit: '0068_travel_no_double_save.sql',
  employee_add_travel_expense: '0068_travel_no_double_save.sql',
  employee_submit_travel_claim: '0066_travel_standalone_expenses.sql',
  manager_get_team_travel_summary: '0046_travel_expenses_and_summary.sql',
  admin_get_travel_overview: '0046_travel_expenses_and_summary.sql',
}
let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }
const liveBody = async name => (await client.query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name])).rows

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  // 1. live == latest repo version, for all five
  for (const [name, file] of Object.entries(LATEST)) {
    const rows = await liveBody(name)
    check(`live ${name} == ${file}`, rows.length === 1 && norm(rows[0].prosrc) === bodyFromFile(file, name))
  }
  if (failed) { console.log('\nLive code differs from the repo — nothing changed.'); process.exit(1) }

  // 2. dry run inside a transaction
  await client.query('begin')
  // inside this transaction only: the session-token checks always say yes, so we can call the functions directly
  await client.query(`create or replace function public.is_valid_employee_token(p_token uuid, p_emp_id uuid) returns boolean language sql as $$ select true $$`)
  await client.query(`create or replace function public.is_valid_admin_token(p_token uuid) returns boolean language sql as $$ select true $$`)

  const { rows: [d] } = await client.query(`select to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD') as today, to_char((now() at time zone 'Asia/Kolkata')::date - 6,'YYYY-MM-DD') as d6`)
  const pick = async (cond) => (await client.query(`select e.id, e.name, e.manager_emp_id from employees e where e.deleted_at is null and e.active and ${cond} order by e.name limit 1`)).rows[0]
  const office = await pick(`coalesce(e.work_mode,'office') not in ('field','both') and e.manager_emp_id is not null and not exists (select 1 from travel_visits v where v.emp_id=e.id) and not exists (select 1 from travel_expenses x where x.emp_id=e.id)`)
  const office2 = (await client.query(`select e.id from employees e where e.deleted_at is null and e.active and coalesce(e.work_mode,'office') not in ('field','both') and e.id <> $1 and e.manager_emp_id = $2 and not exists (select 1 from travel_visits v where v.emp_id=e.id) limit 1`, [office.id, office.manager_emp_id])).rows[0]
  const field = await pick(`e.work_mode in ('field','both')`)
  if (!office || !field) throw new Error('need one office-only and one field employee to test with')
  console.log(`Office-only test employee: ${office.name}; field test employee: ${field.name} (all changes rolled back)`)
  const T = '00000000-0000-0000-0000-000000000000'
  const N = office.id

  let sp = 0
  async function run(label, expect, fn) { // expect: true | RegExp (error pattern)
    const name = `s${++sp}`
    await client.query(`savepoint ${name}`)
    let ok = false, detail = ''
    try { const r = await fn(); ok = expect === true; detail = ok ? '' : 'was ACCEPTED'; if (r && r.note) detail = r.note }
    catch (e) { ok = expect instanceof RegExp && expect.test(e.message); detail = e.message }
    check(label, ok, detail)
    await client.query(`rollback to savepoint ${name}`)
  }
  const punchedIn = async emp => client.query(`insert into attendance (emp_id, date, in_time, in_lat, in_lon) values ($1, $2, '09:30', 28.6, 77.2)
      on conflict (emp_id, date) do update set in_time='09:30', out_time=null, in_lat=28.6, in_lon=77.2`, [emp, d.today])
  const addExpense = emp => client.query(`select * from employee_add_travel_expense($1,$2,'Toll',100,'r.jpg',28.6,77.2,10,null,null)`, [T, emp])
  const addVisit = emp => client.query(`select * from employee_add_travel_visit($1,$2,$3::date,28.61,77.21,10,'Test client','s.jpg')`, [T, emp, d.today])

  // BEFORE the migration: the old rule really was in force (proves the test can see the difference)
  await run('BEFORE 0077: office-only staff expense is refused (old rule)', /only available for Field/, () => addExpense(N))

  await client.query(sql)
  console.log('— 0077 installed inside the transaction —')

  await run('office-only staff can add an expense', true, () => addExpense(N))
  await run('office-only staff can log a visit (after punching in)', true, async () => { await punchedIn(N); await addVisit(N) })
  await run('visit still needs punch-in first (rule kept)', /Punch in before/, async () => { await client.query(`delete from attendance where emp_id=$1 and date=$2`, [N, d.today]); await addVisit(N) })
  await run('visit still needs a selfie (rule kept)', /Selfie photo is required/, () => client.query(`select * from employee_add_travel_visit($1,$2,$3::date,28.61,77.21,10,'Test client','')`, [T, N, d.today]))
  await run('expense still needs a valid category (rule kept)', /Choose an expense type/, () => client.query(`select * from employee_add_travel_expense($1,$2,'Nope',100,'r.jpg',28.6,77.2,10,null,null)`, [T, N]))
  await run('field staff still can add an expense (no regression)', true, () => addExpense(field.id))

  // claim: no tier → refused; with tier + 5 days of data → accepted
  const seedClaimData = async () => { await punchedIn(N); await addVisit(N); await client.query(`update travel_visits set date = $2::date where emp_id = $1`, [N, d.d6]) }
  await run('claim without a rate tier → "ask HR" message kept', /rate tier is not set/, async () => {
    await seedClaimData(); await client.query(`update employees set ta_rate_tier = null where id = $1`, [N])
    await client.query(`select * from employee_submit_travel_claim($1,$2,$3::date)`, [T, N, d.today])
  })
  await run('claim with a tier set by HR → submitted', true, async () => {
    await seedClaimData(); await client.query(`update employees set ta_rate_tier = 'executive' where id = $1`, [N])
    const r = await client.query(`select * from employee_submit_travel_claim($1,$2,$3::date)`, [T, N, d.today])
    return { note: `claim status ${r.rows[0].status}` }
  })

  // lists: person with data appears; person without data does not; field staff still listed
  await run('manager + admin lists show an office-only person once they have data', true, async () => {
    await addExpense(N)
    const m = await client.query(`select emp_id from manager_get_team_travel_summary($1,$2)`, [T, office.manager_emp_id])
    const a = await client.query(`select emp_id from admin_get_travel_overview($1)`, [T])
    if (!m.rows.some(r => r.emp_id === N)) throw new Error('missing from the manager list')
    if (!a.rows.some(r => r.emp_id === N)) throw new Error('missing from the admin list')
  })
  await run('office-only person with NO data is not listed (no empty rows)', true, async () => {
    const a = await client.query(`select emp_id from admin_get_travel_overview($1)`, [T])
    if (a.rows.some(r => r.emp_id === N)) throw new Error('listed although they have no data')
  })
  await run('field staff with no data are still listed', true, async () => {
    const a = await client.query(`select emp_id from admin_get_travel_overview($1)`, [T])
    if (!a.rows.some(r => r.emp_id === field.id)) throw new Error('field person vanished from the admin list')
  })

  await client.query('rollback')
  console.log('\nDry run rolled back — production unchanged.')
  if (failed) { console.log(`\n${failed} CHECK(S) FAILED — not applying.`); process.exit(1) }
  console.log('\nAll checks passed.')

  if (APPLY) {
    await client.query('begin')
    await client.query(sql)
    for (const [name] of Object.entries(LATEST)) {
      const rows = await liveBody(name)
      if (rows.length !== 1) throw new Error(`${name}: expected exactly one function`)
      if (norm(rows[0].prosrc) !== bodyFromFile('0077_my_journey_for_all_employees.sql', name)) throw new Error(`${name}: installed body differs from the file`)
    }
    // permissions must be exactly what they were (create or replace keeps them) — still callable by the app role
    const { rows: acl } = await client.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1)`, [Object.keys(LATEST)])
    console.log('anon execute:', acl.map(r => `${r.proname}=${r.anon}`).join(', '))
    await client.query(`select log_audit('MIGRATION', 'Migration 0077 applied: My Journey open to all employees, plan.md §63', 'system')`)
    await client.query('commit')
    console.log('✓ Migration 0077 is LIVE.')
  } else {
    console.log('Re-run with --apply to install it for real.')
  }
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('\nERROR:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
