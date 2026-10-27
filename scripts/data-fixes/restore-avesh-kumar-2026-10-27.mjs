#!/usr/bin/env node
// Bring back Avesh Kumar (#1179), erased earlier today by remove-lamora-company-2026-10-27.mjs.
//
// What the backup holds: his dependent rows IN FULL (attendance, leave balances/accruals, payout, location
// logs), but of the employee row itself only id / emp_num / name / company (that script's backup query
// selected just those). So the employee row is rebuilt from the HR sheet (position, business unit,
// department, location, manager) and a PIN that HR must change; everything else (email, phone, date of
// birth, joining date, shift, work mode...) is NOT recoverable and is left blank/default for HR to re-enter.
//
// Date trap: the backup wrote `date` columns as local-midnight-in-IST converted to UTC
// ("2026-08-16T18:30:00.000Z" really means 17 Aug). Those are shifted back +5:30 here.
//
// DEFAULT = DRY RUN (transaction rolled back). --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/restore-avesh-kumar-2026-10-27.mjs <backup.json> [--apply] [--company "X"]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const file = process.argv[2]
if (!file) { console.error('Give the backup file path.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const ci = process.argv.indexOf('--company')
const COMPANY = ci > 0 ? process.argv[ci + 1] : 'Asma Traexim Pvt Ltd' // Lamora no longer exists as a company
const TEMP_PIN = '1179' // the importer's own default (last 4 of emp number); HR to change

const backup = JSON.parse(fs.readFileSync(file, 'utf8'))
const [emp] = backup.employees
if (backup.employees.length !== 1 || emp.name !== 'Avesh Kumar') throw new Error('Backup is not the single Avesh Kumar record')

const shiftDate = v => (typeof v === 'string' && /T\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) ? new Date(new Date(v).getTime() + 19800000).toISOString().slice(0, 10) : v

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  await client.query(`set local search_path to public, extensions`)
  const { rows: clash } = await client.query(`select 1 from employees where id = $1 or emp_num = $2`, [emp.id, emp.emp_num])
  if (clash.length) throw new Error('An employee with this id or emp number already exists — nothing restored')
  const { rows: [mgr] } = await client.query(`select id, name from employees where name ilike 'Narender Kumar%' and deleted_at is null limit 1`)

  await client.query(
    `insert into employees (id, emp_num, name, pin, company, job_title, business_unit, department, location_info, manager, manager_emp_id, active)
     values ($1,$2,$3,crypt($4, gen_salt('bf')),$5,'Sr Sales Manager','Head Office','Sales','Head Office','Narender Kumar',$6,true)`,
    [emp.id, emp.emp_num, emp.name, TEMP_PIN, COMPANY, mgr?.id ?? null])
  console.log(`employees: restored 1 in "${COMPANY}"; manager "Narender Kumar" ${mgr ? 'linked' : 'is not an employee in the app — kept as text only'}`)
  console.log('NOTE: Sr Sales Manager is not in the Job Title dropdown yet; pick/add it when editing.')

  for (const [key, rows] of Object.entries(backup.dependents)) {
    if (!rows.length) continue
    const [tbl, col] = key.split('.')
    if (tbl === 'employees' || col !== 'emp_id') continue
    const { rows: types } = await client.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1`, [tbl])
    const dateCols = new Set(types.filter(t => t.data_type === 'date').map(t => t.column_name))
    for (const r of rows) {
      for (const c of dateCols) if (c in r) r[c] = shiftDate(r[c])
      await client.query(`insert into ${tbl} select * from json_populate_record(null::${tbl}, $1::json)`, [JSON.stringify(r)])
    }
    const { rows: [n] } = await client.query(`select count(*)::int n from ${tbl} where emp_id = $1`, [emp.id])
    console.log(`${tbl}: backup ${rows.length}, now ${n.n}`)
    if (n.n !== rows.length) throw new Error(`${tbl}: ${n.n} rows after restore, backup has ${rows.length} — rolled back`)
  }
  const { rows: days } = await client.query(`select to_char(date,'YYYY-MM-DD Dy') d from attendance where emp_id = $1 order by date`, [emp.id])
  console.log('attendance days restored:', days.map(r => r.d).join(', '))
  if (days.some(r => r.d.endsWith('Sun'))) console.log('  (a Sunday is present — fine only if he really worked that day)')

  if (APPLY) { await client.query('commit'); console.log('\nCOMMITTED.') }
  else { await client.query('rollback'); console.log('\nDRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
