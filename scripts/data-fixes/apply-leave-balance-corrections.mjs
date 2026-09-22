#!/usr/bin/env node
// One-off correction: HR supplies a real "Leave Balance Sheet.xlsx" with the actual
// current Sick/Casual/Earned balance for however many employees are on the sheet (the
// rest keep whatever they already have — this is a partial correction, not a full
// resync).
//
// Why not the existing in-app importer (useLeaveBalanceImport.js)? Two problems that
// only matter for a *correction* import, not the original master-data import it was
// built for:
//   1. It skips a leave type entirely when balance/consumed/accrued/quota are all 0 —
//      so an employee who has genuinely used up a leave type (real balance 0) would
//      keep whatever stale balance they had before. This sheet has real zeros.
//   2. It has no Quota/Consumed/Accrued columns, so its fallback is
//      `finalQuota = quota || bal + cons || bal` -> quota becomes equal to balance.
//      That would silently overwrite each employee's real annual quota (12/6/4) with
//      whatever their current balance happens to be, breaking the balance/quota
//      progress bar everywhere it's shown (LeaveApply.jsx, Employees.jsx, Database.jsx).
//
// V2 Phase C (2026-08-10) changed what the "pool" a balance is drawn from actually
// means: CL/EL now accrue monthly in arrears (0024-0026) instead of being front-loaded
// as the full annual `quota` on day one, so `accrued` — not `quota` — is now the
// correct pool a sheet-supplied balance should be reconciled against. `quota` stays the
// fixed annual entitlement (still used for display/caps elsewhere) and `accrued` stays
// exactly what the system's own monthly-accrual math already computed from each
// employee's joining date — this script never touches either. It only overwrites
// balance + consumed (consumed = accrued - balance), so the next monthly credit or any
// future correction still sees a self-consistent accrued/consumed/balance triple.
//
// Usage (dry run by default — prints the diff, writes nothing):
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-leave-balance-corrections.mjs "C:/Users/aisup/Downloads/Leave Balance Sheet Updated.xlsx"
//
// Add --apply to actually write:
//   ... node scripts/apply-leave-balance-corrections.mjs "<path>" --apply

import pg from 'pg'
import fs from 'fs'
import * as XLSX from 'xlsx'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const args = process.argv.slice(2).filter(a => a !== '--apply')
const apply = process.argv.includes('--apply')
const filePath = args[0]
if (!filePath) {
  console.error('Usage: node scripts/apply-leave-balance-corrections.mjs <path-to-xlsx> [--apply]')
  process.exit(2)
}

// Sheet's "Company" column uses short codes; DB stores the full legal name.
const COMPANY_MAP = {
  atpl: 'Asma Traexim Pvt Ltd',
  metamask: 'Metamask Design Solutions LLP',
  lamora: 'Lamora Buildtech Pvt Ltd',
}

const COLUMN_TO_LEAVE_TYPE = {
  'Sick Leave Balance': 'Sick Leave',
  'Casual Leave Balance': 'Casual Leave',
  'Earned Leave Balance': 'Earned Leave',
}

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}
function normCode(s) {
  return String(s ?? '').trim().replace(/^0+/, '')
}
// Guards against a code match landing on the wrong employee. Found live: several sheet
// rows carry an Employee Code that collides (after stripping leading zeros) with a
// completely different employee's real emp_num — e.g. "Manish Kumar" code=1 collides
// with a placeholder record literally named "00000001", "Anshu" code=00000005 collides
// with Upasana's real emp_num. Requires a real word overlap (exact word, or one word a
// 4+ char prefix of the other, to catch typos like "harendraD" vs "Harendra Chaubey")
// before a code match is trusted.
function namesPlausiblyMatch(sheetName, empName) {
  const a = normName(sheetName).split(' ').filter(Boolean)
  const b = normName(empName).split(' ').filter(Boolean)
  if (!a.length || !b.length) return false
  return a.some(w => b.some(bw => w === bw || (w.length >= 4 && bw.length >= 4 && (w.startsWith(bw) || bw.startsWith(w)))))
}

async function main() {
  // The ESM build of xlsx doesn't reliably hook Node's fs for readFile() — read the
  // bytes ourselves and hand them to XLSX.read() instead.
  const wb = XLSX.read(fs.readFileSync(filePath))
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  console.log(`Read ${rows.length} rows from "${filePath}".`)

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const { rows: employees } = await client.query(
    `select id, name, emp_num, company from employees where deleted_at is null`
  )
  const { rows: balances } = await client.query(
    `select emp_id, leave_type, accrued, consumed, balance, quota, unit
       from leave_balances where financial_year = current_fy()`
  )
  const balKey = (empId, lt) => `${empId}::${lt}`
  const balanceByKey = new Map(balances.map(b => [balKey(b.emp_id, b.leave_type), b]))

  const byCode = new Map()
  const byName = new Map()
  for (const e of employees) {
    if (e.emp_num) byCode.set(normCode(e.emp_num), e)
    const key = normName(e.name)
    byName.set(key, (byName.get(key) || []).concat(e))
  }

  const updates = []       // { emp, leaveType, oldBalance, newBalance, oldConsumed, newConsumed, quota }
  const unmatched = []     // sheet rows with no confident employee match
  const skippedNoQuota = [] // matched employee, but no existing balance row for that leave type

  for (const row of rows) {
    const sheetName = row['Employee Name']
    const sheetCode = row['Employee Code']
    const sheetCompany = COMPANY_MAP[normName(row['Company']).replace(/\s+/g, '')] || null

    // Priority: an exact, unique name match is trusted over the sheet's Employee Code
    // column — live data showed that column is frequently wrong (row-order numbers,
    // typos, or codes that happen to collide with an unrelated employee's real emp_num).
    // The code is only used to disambiguate when a code AND the name both point the
    // same way, or when the name alone is ambiguous.
    let emp = null
    let codeCandidate = sheetCode !== '' ? byCode.get(normCode(sheetCode)) : null
    const nameCandidates = byName.get(normName(sheetName)) || []

    if (nameCandidates.length === 1) {
      emp = nameCandidates[0]
    } else if (codeCandidate && namesPlausiblyMatch(sheetName, codeCandidate.name)) {
      emp = codeCandidate
    } else if (nameCandidates.length > 1) {
      const byCompany = sheetCompany ? nameCandidates.filter(c => c.company === sheetCompany) : []
      if (byCompany.length === 1) emp = byCompany[0]
      else {
        unmatched.push({ row, reason: `${nameCandidates.length} employees named "${sheetName}" — ambiguous even with company "${row['Company']}", needs Employee Code` })
        continue
      }
    }

    if (!emp) {
      if (codeCandidate) {
        unmatched.push({ row, reason: `Employee Code ${sheetCode} belongs to "${codeCandidate.name}" in the database, not "${sheetName}" — skipped, needs manual check` })
      } else {
        unmatched.push({ row, reason: `no employee found for code="${sheetCode}" name="${sheetName}"` })
      }
      continue
    }

    for (const [col, leaveType] of Object.entries(COLUMN_TO_LEAVE_TYPE)) {
      const cell = row[col]
      if (cell === '' || cell === null || cell === undefined) continue // no data for this type, leave untouched
      const newBalance = Number(cell)
      if (Number.isNaN(newBalance)) continue

      const existing = balanceByKey.get(balKey(emp.id, leaveType))
      if (!existing) {
        skippedNoQuota.push({ emp, leaveType, newBalance })
        continue
      }
      // Pool is `accrued` now (V2 Phase C), not `quota` — see header note. Not floored
      // at 0: a negative result means the sheet's balance is higher than what the
      // system's own monthly-accrual math has credited so far for this employee, which
      // is worth seeing in the dry run rather than silently clamping away.
      const newConsumed = Number(existing.accrued) - newBalance
      if (Number(existing.balance) === newBalance && Number(existing.consumed) === newConsumed) continue // no change

      updates.push({
        emp, leaveType,
        oldBalance: Number(existing.balance), newBalance,
        oldConsumed: Number(existing.consumed), newConsumed,
        accrued: Number(existing.accrued),
        quota: Number(existing.quota),
      })
    }
  }

  console.log(`\nMatched rows with at least one real change: ${new Set(updates.map(u => u.emp.id)).size}`)
  console.log(`Total balance rows to update: ${updates.length}`)
  for (const u of updates) {
    const flag = u.newConsumed < 0 ? '  ⚠ consumed would go negative — sheet balance exceeds accrued' : ''
    console.log(
      `  ${u.emp.name.padEnd(24)} ${u.leaveType.padEnd(14)} balance ${u.oldBalance} -> ${u.newBalance}` +
      `  consumed ${u.oldConsumed} -> ${u.newConsumed}  (accrued ${u.accrued}, quota ${u.quota}, both unchanged)${flag}`
    )
  }

  if (unmatched.length) {
    console.log(`\nUnmatched rows (${unmatched.length}) — need manual review, nothing done for these:`)
    for (const u of unmatched) console.log(`  ${JSON.stringify(u.row['Employee Name'])} code=${JSON.stringify(u.row['Employee Code'])} — ${u.reason}`)
  }
  if (skippedNoQuota.length) {
    console.log(`\nMatched employee but no existing "${skippedNoQuota.map(s => s.leaveType).join('/')}" balance row (${skippedNoQuota.length}) — skipped, would need admin_upsert_leave_balance with a real quota first:`)
    for (const s of skippedNoQuota) console.log(`  ${s.emp.name} — ${s.leaveType} (sheet says ${s.newBalance})`)
  }

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to write these updates.')
    await client.end()
    return
  }

  await client.query('begin')
  try {
    for (const u of updates) {
      await client.query(
        `update leave_balances set balance = $1, consumed = $2
           where emp_id = $3 and leave_type = $4 and financial_year = current_fy()`,
        [u.newBalance, u.newConsumed, u.emp.id, u.leaveType]
      )
    }
    await client.query(
      `insert into audit_logs (action, detail, by_name) values ($1, $2, 'admin')`,
      ['LEAVE_BALANCE_BULK_IMPORT', `Correction from Leave Balance Sheet.xlsx: ${updates.length} rows updated`]
    )
    await client.query('commit')
    console.log(`\nApplied. ${updates.length} balance rows updated.`)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
