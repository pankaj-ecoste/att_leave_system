import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { adminCreateEmployee, adminUpdateEmployee } from '../api/employees'
import { adminFetchImportedSheet, adminSetImportedSheet, adminClearImportedSheet } from '../api/imports'
import { gField, findEmpInSnap } from '../lib/importHelpers'
import { COMPANIES } from '../lib/constants'

// 'LOP' — renamed from 'Unpaid Leave' (P4B-11) to match the leave_type value the app
// now stores; an import sheet still using the old "Unpaid Leave" column header won't be
// picked up here, but LOP was never a balance-tracked type (it's unlimited by
// definition) so this column was never meaningfully populated either way.
const LEAVE_FIELDS = ['Sick Leave', 'Casual Leave', 'Earned Leave', 'LOP', 'Bereavement Leave', 'Marriage Leave', 'Maternity Leave', 'Paternity Leave']

// Matches a free-text company column against the 3 known companies (case-insensitive,
// tolerant of "Asma Traexim" vs the full legal name "Asma Traexim Pvt Ltd"). Falls back
// to the existing employee's company on update, or the first company only as a last
// resort for genuinely new employees with no company column at all — this was the old
// bug (plan.md P2-7): imports always defaulted to COMPANIES[0], even when the file
// said otherwise.
function resolveCompany(row, fallback) {
  const raw = gField(row, 'Company', 'Company Name', 'COMPANY').toLowerCase()
  if (!raw) return fallback
  const match = COMPANIES.find(c => c.toLowerCase().includes(raw) || raw.includes(c.toLowerCase().split(' ')[0]))
  return match || fallback
}

// Excel importer #1 — leave balance / employee master data. One row per employee:
// identity + org fields, plus optional [Leave Type] - Accrued/Consumed/Balance/
// AnnualQuota/Unit columns. Missing employees are auto-created.
export function useLeaveBalanceImport(token, employees, setEmployees, bulkUpsertLeaveBalances, onAudit) {
  const [sheet, setSheet] = useState(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!token) return
    adminFetchImportedSheet(token).then(setSheet).catch(console.error)
  }, [token])

  async function persistSheet(next) {
    setSheet(next)
    try {
      await adminSetImportedSheet(token, next.filename, next.cols, next.rows)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleImport(file) {
    setStatus('Loading...')
    try {
      const ab = await file.arrayBuffer()
      const wb = XLSX.read(ab, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      let created = 0, updated = 0
      let currentEmployees = [...employees]
      const balanceRecords = []

      for (const row of rows) {
        const name = gField(row, 'Employee Name', 'Name', 'EMPLOYEE NAME')
        const empNum = gField(row, 'Employee Number', 'Emp No', 'EMP NO', 'Emp Code', 'EMP CODE', 'Employee Code')
        if (!name && !empNum) continue
        let emp = findEmpInSnap(empNum, name, currentEmployees)
        const fields = {
          empNum: empNum || emp?.empNum || '',
          jobTitle: gField(row, 'Job Title', 'Designation'),
          bu: gField(row, 'Business Unit', 'BU'),
          dept: gField(row, 'Department', 'Dept'),
          subDept: gField(row, 'Sub Department', 'Sub Dept'),
          locationInfo: gField(row, 'Location'),
          costCenter: gField(row, 'Cost Center'),
          manager: gField(row, 'Reporting Manager', 'Manager'),
        }
        try {
          if (!emp) {
            const pin = empNum ? empNum.replace(/^0+/, '').slice(-4).padStart(4, '0') : '0000'
            const company = resolveCompany(row, COMPANIES[0])
            emp = await adminCreateEmployee(token, { name: name || empNum, pin, company, ...fields })
            currentEmployees = [...currentEmployees, emp]
            created++
          } else {
            const company = resolveCompany(row, emp.company)
            emp = await adminUpdateEmployee(token, emp.id, { ...emp, ...fields, company })
            currentEmployees = currentEmployees.map(x => (x.id === emp.id ? emp : x))
            updated++
          }
          for (const lt of LEAVE_FIELDS) {
            const bal = Number(row[`${lt} - Balance`] || row[`${lt} Balance`] || row[`${lt} - balance`] || 0) || 0
            const cons = Number(row[`${lt} - Consumed`] || row[`${lt} Consumed`] || row[`${lt} - consumed`] || 0) || 0
            const accr = Number(row[`${lt} - Accrued`] || row[`${lt} Accrued`] || row[`${lt} - accrued`] || 0) || 0
            const quota = Number(row[`${lt} - AnnualQuota`] || row[`${lt} Annual Quota`] || row[`${lt} Quota`] || 0) || 0
            if (bal === 0 && cons === 0 && accr === 0 && quota === 0) continue
            const finalQuota = quota || bal + cons || bal
            const finalAccr = accr || finalQuota
            balanceRecords.push({
              empId: emp.id, leaveType: lt, accrued: finalAccr, consumed: cons, balance: bal, quota: finalQuota,
              unit: String(row[`${lt} - Unit`] || row[`${lt} Unit`] || 'Days').trim(),
            })
          }
        } catch (rowErr) {
          console.error('Import row failed:', name, rowErr)
        }
      }

      setEmployees(currentEmployees)
      if (balanceRecords.length) await bulkUpsertLeaveBalances(balanceRecords)
      await persistSheet({ filename: file.name, rows, cols: rows.length > 0 ? Object.keys(rows[0]) : [], importedAt: new Date().toISOString() })
      setStatus(`Imported: ${created} created, ${updated} updated (${currentEmployees.length} total)`)
      onAudit?.('IMPORT', `Leave balance: ${file.name}`, 'admin')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  async function removeSheet() {
    try {
      await adminClearImportedSheet(token)
      setSheet(null)
      setStatus('')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  async function exportSheet() {
    if (!sheet) return
    const ws = XLSX.utils.json_to_sheet(sheet.rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    XLSX.writeFile(wb, 'exported_sheet.xlsx')
  }

  async function editCell(rowIndex, col, value) {
    const newRows = sheet.rows.map((row, i) => (i === rowIndex ? { ...row, [col]: value } : row))
    await persistSheet({ ...sheet, rows: newRows })
  }

  async function deleteRow(rowIndex) {
    const newRows = sheet.rows.filter((_, i) => i !== rowIndex)
    await persistSheet({ ...sheet, rows: newRows })
  }

  return { sheet, status, handleImport, removeSheet, exportSheet, editCell, deleteRow }
}
