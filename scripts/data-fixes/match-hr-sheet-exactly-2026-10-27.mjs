#!/usr/bin/env node
// Make the app match HR's 78-row "total head count" sheet (2026-10-27) exactly, and keep the 5 directors.
//   1. Bring back Md. Samir (#1139) and Sameer Ansari (#1253) — removed earlier today, but in the sheet
//      (soft-removal only, so this clears deleted_at and sets active = true; their history is intact).
//   2. Field fixes where the sheet differs from the app (the sheet's value wins, including blanks):
//        - Business Unit "Asma Traexim Pvt Ltd" (HR's value; replaces "Ecoste") for 10 people
//        - Dev Dixit BU -> Head Office; Kush Tripathi department -> Installation
//        - Anshu / Manish Kumar / Manvendra Singh department -> blank
//        - Bhaskar Gera location -> "Metamask"
//      The two new list values ("Asma Traexim Pvt Ltd" as a Business Unit, "Metamask" as a Location) are added
//      to the dropdown lists. "Ecoste" is left in the Business Unit list (nobody uses it now) — removable in Settings.
//   3. Ankur Hora x2, Suman Hora, Amrit Lal Hora, Aastha Hora are NOT in the sheet but stay live (HR's decision).
// Each fix checks the CURRENT value first and aborts if it is not what was seen — nothing is overwritten blind.
// A full-row JSON backup of every touched employee is written before commit.
//
// DEFAULT = DRY RUN (rolled back). --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/match-hr-sheet-exactly-2026-10-27.mjs [--apply]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')

const RESTORE = ['1139', '1253']
const BU_ASMA = ['1211', '1248', '1257', '1259', '1186', '1255', '1260', '1274', '1249', '1273']
// emp_num -> [column, expected current value, new value]
const FIXES = [
  ...BU_ASMA.map(n => [n, 'business_unit', undefined, 'Asma Traexim Pvt Ltd']), // current differs per person (Ecoste / blank / Head Office)
  ['1270', 'business_unit', 'Ecoste', 'Head Office'],
  ['1268', 'department', 'Accounts & Finance', 'Installation'],
  ['1140', 'department', 'MetaMask', null],
  ['1166', 'department', 'MetaMask', null],
  ['1132', 'department', 'Meta Mask', null],
  ['1275', 'location_info', 'Ghitorni', 'Metamask'],
]
const NEW_OPTIONS = [['business_unit', 'Asma Traexim Pvt Ltd'], ['location', 'Metamask']]
const KEEP_LIVE = ['1213', '1254', '1192', '1219', '1221'] // Ankur Hora x2, Suman, Amrit Lal, Aastha

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const touched = [...new Set([...RESTORE, ...FIXES.map(f => f[0]), ...KEEP_LIVE])]
  const { rows: backupRows } = await client.query(`select * from employees where emp_num = any($1)`, [touched])
  if (APPLY) {
    fs.mkdirSync('C:\\ecoste\\backups', { recursive: true })
    const file = `C:\\ecoste\\backups\\employees-before-match-hr-sheet-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
    fs.writeFileSync(file, JSON.stringify(backupRows, null, 2))
    console.log('Full-row backup written:', file)
  }

  await client.query('begin')
  for (const n of RESTORE) {
    const r = await client.query(`update employees set deleted_at = null, active = true, updated_at = now() where emp_num = $1 and deleted_at is not null returning name`, [n])
    if (r.rowCount !== 1) throw new Error(`#${n} is not a removed employee — refusing`)
    await client.query(`select log_audit('EMPLOYEE_RESTORE', $1, 'admin')`, [`${r.rows[0].name.trim()} #${n} (in HR's head-count sheet)`])
    console.log(`restored #${n} ${r.rows[0].name.trim()}`)
  }
  for (const [kind, value] of NEW_OPTIONS) {
    const r = await client.query(`insert into dropdown_options(kind, value) values ($1, $2) on conflict (kind, lower(value)) do nothing returning value`, [kind, value])
    console.log(r.rowCount ? `list value added: ${kind} = "${value}"` : `list value already there: ${kind} = "${value}"`)
  }
  for (const [num, col, expected, next] of FIXES) {
    const { rows: [cur] } = await client.query(`select name, ${col} as v from employees where emp_num = $1 and deleted_at is null`, [num])
    if (!cur) throw new Error(`#${num} not live`)
    if (expected !== undefined && (cur.v ?? null) !== expected) throw new Error(`#${num} ${cur.name.trim()} ${col} is "${cur.v}", expected "${expected}" — refusing to overwrite`)
    await client.query(`update employees set ${col} = $1, updated_at = now() where emp_num = $2`, [next, num])
    console.log(`  #${num} ${cur.name.trim().padEnd(26)} ${col}: ${JSON.stringify(cur.v)} -> ${JSON.stringify(next)}`)
  }
  for (const n of KEEP_LIVE) {
    const { rows } = await client.query(`select 1 from employees where emp_num = $1 and deleted_at is null and active`, [n])
    if (rows.length !== 1) throw new Error(`#${n} must stay live but is not`)
  }
  const { rows: [t] } = await client.query(`select count(*)::int n from employees where deleted_at is null`)
  console.log(`live staff after: ${t.n}`)
  if (t.n !== 83) throw new Error(`Expected 83 live (78 sheet + 5 directors), got ${t.n} — rolled back`)
  if (APPLY) { await client.query('commit'); console.log('COMMITTED.') }
  else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
