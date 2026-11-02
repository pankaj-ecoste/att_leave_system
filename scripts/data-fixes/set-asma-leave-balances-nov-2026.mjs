#!/usr/bin/env node
// HR's real leave balances for the Asma staff (sheet "October_Leave_Balance_Record_2026_27.xlsx", balances as on
// 31.10.2026) go into the app. The 1 November monthly credit is added on top: Casual Leave +1, Earned Leave +0.5.
// Sick Leave is taken exactly as in the sheet. Whatever the app holds today for these people is ignored (replaced).
//
// Only balance + consumed are written (consumed = accrued - balance), like apply-leave-balance-corrections.mjs.
// accrued and quota are not touched. Staff not on the sheet are not touched.
//
// DEFAULT = DRY RUN (nothing written). --apply: JSON backup of the current balance rows first, then one transaction.
// Usage: DATABASE_URL=... node scripts/data-fixes/set-asma-leave-balances-nov-2026.mjs "<xlsx path>" [--apply]
import pg from 'pg'
import fs from 'fs'
import * as XLSX from 'xlsx'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const file = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!file) { console.error('Give the xlsx path.'); process.exit(2) }

const ADD = { 'Casual Leave': 1, 'Earned Leave': 0.5, 'Sick Leave': 0 }
const COLS = { 'Sick Leave': 'Sick Leave - Balance', 'Casual Leave': 'Casual Leave - Balance', 'Earned Leave': 'Earned Leave - Balance' }
// sheet spelling -> app spelling (confirmed by the matching staff in the app)
const ALIAS = { 'payal kr mandal': 'payal mandal', 'aditya ranjan': 'aditya rajan chavan', 'tarun': 'tarun abrol' }
// staff with no balance rows at all yet: rows are created (quota as for the other Aug/Sep joiners)
const CREATE_QUOTA = { 'Sick Leave': 4, 'Casual Leave': 6, 'Earned Leave': 3 }
const norm = s => String(s || '').trim().toLowerCase().replace(/[.\s]+/g, ' ').trim()

const wb = XLSX.read(fs.readFileSync(file))
const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => Number.isFinite(Number(r['S No.'])) && String(r['Employee Name']).trim())
console.log(`Sheet rows with a name: ${sheetRows.length}`)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows: emps } = await client.query(`select id, name, emp_num, company from employees where deleted_at is null`)
  const { rows: bals } = await client.query(`select id, emp_id, leave_type, accrued, consumed, balance, quota from leave_balances where financial_year = current_fy()`)
  const balOf = new Map(bals.map(b => [`${b.emp_id}|${b.leave_type}`, b]))

  const updates = [], creates = [], problems = [], matched = new Set()
  for (const r of sheetRows) {
    const key = norm(r['Employee Name']), want = ALIAS[key] || key
    const cands = emps.filter(e => norm(e.name) === want)
    if (cands.length !== 1) { problems.push(`${r['Employee Name']}: ${cands.length} employees with this name`); continue }
    const e = cands[0]; matched.add(e.id)
    for (const lt of Object.keys(COLS)) {
      const cell = r[COLS[lt]]
      if (cell === '' || Number.isNaN(Number(cell))) { problems.push(`${e.name}: no number for ${lt}`); continue }
      const b = balOf.get(`${e.id}|${lt}`)
      const sheet = Number(cell), nb = sheet + ADD[lt]
      if (!b) {
        if (bals.some(x => x.emp_id === e.id)) { problems.push(`${e.name}: no ${lt} balance row in the app`); continue }
        creates.push({ e, lt, nb }); continue
      }
      const accrued = Math.max(Number(b.accrued), nb) // never let consumed go negative
      updates.push({ e, lt, b, sheet, nb, accrued, newConsumed: accrued - nb })
    }
  }

  console.log(`\n${'Name'.padEnd(26)} ${'SL old>new'.padEnd(11)} ${'CL sheet+1: old>new'.padEnd(22)} EL sheet+0.5: old>new`)
  for (const id of matched) {
    const u = updates.filter(x => x.e.id === id); if (!u.length) { console.log(emps.find(e => e.id === id).name.padEnd(26) + ' (no balance rows to write)'); continue } const n = u[0].e.name.padEnd(26)
    const f = lt => { const x = u.find(y => y.lt === lt); return x ? `${x.b.balance}>${x.nb}` : '-' }
    console.log(`${n} ${f('Sick Leave').padEnd(11)} ${f('Casual Leave').padEnd(22)} ${f('Earned Leave')}`)
  }
  const neg = updates.filter(u => u.accrued > Number(u.b.accrued))
  const asmaNotOnSheet = emps.filter(e => e.company === 'Asma Traexim Pvt Ltd' && !matched.has(e.id))
  console.log(`\nStaff matched: ${matched.size}   balance rows to update: ${updates.length}   rows to create: ${creates.length}`)
  creates.forEach(c => console.log('  CREATE ' + c.e.name + ' ' + c.lt + ' balance ' + c.nb + ' quota ' + CREATE_QUOTA[c.lt]))
  console.log(`Rows where 'accrued' is raised to equal the new balance: ${neg.length}`)
  console.log(`Asma staff in the app but NOT on the sheet (left untouched): ${asmaNotOnSheet.length}${asmaNotOnSheet.length ? ' -> ' + asmaNotOnSheet.map(e => e.name).join(', ') : ''}`)
  if (problems.length) { console.log('\nPROBLEMS (nothing will be written until these are solved):'); problems.forEach(p => console.log('  ' + p)) }

  if (!APPLY) { console.log('\nDRY RUN — nothing written.'); }
  else if (problems.length) { throw new Error('Problems above — nothing changed') }
  else {
    fs.mkdirSync('C:\\ecoste\\backups', { recursive: true })
    const bf = `C:\\ecoste\\backups\\asma-leave-balances-before-nov-2026-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
    fs.writeFileSync(bf, JSON.stringify({ updated_rows_before: updates.map(u => u.b), created_rows: creates.map(c => ({ emp_id: c.e.id, leave_type: c.lt })) }, null, 2)); console.log('Backup written:', bf)
    await client.query('begin')
    for (const u of updates)
      await client.query(`update leave_balances set balance = $1, consumed = $2, accrued = $4, updated_at = now() where id = $3`, [u.nb, u.newConsumed, u.b.id, u.accrued])
    for (const c of creates)
      await client.query(`insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit) values ($1, $2, $3, 0, $3, $4, 'Days')`, [c.e.id, c.lt, c.nb, CREATE_QUOTA[c.lt]])
    await client.query(`insert into audit_logs (action, detail, by_name) values ('LEAVE_BALANCE_BULK_IMPORT', $1, 'admin')`, [`Asma real balances (sheet 31.10.2026) + Nov credit CL+1 EL+0.5: ${matched.size} staff, ${updates.length} updated, ${creates.length} created`])
    await client.query('commit'); console.log('COMMITTED.')
  }
} catch (e) { await client.query('rollback').catch(() => {}); console.error('FAILED:', e.message); process.exitCode = 1 }
await client.end()
