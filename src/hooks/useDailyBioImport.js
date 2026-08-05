import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { adminCreateEmployee, adminUpdateEmployee } from '../api/employees'
import { adminFetchBioSheet, adminSetBioSheet, adminClearBioSheet } from '../api/imports'
import { parseBioTime, parseBioDate, mapBioStatus, normCode, gField, buildEmpMaps } from '../lib/bioImport'
import { calcStatus, todayIST } from '../lib/datetime'
import { COMPANIES, findLeaveType } from '../lib/constants'

// Excel importer #2 — a biometric device's export for a single day (one row per
// employee): arrival/departure times plus late hours, shift, temperature checks, etc.
export function useDailyBioImport(token, employees, setEmployees, attendance, bulkUpsertAttendance, stdHours, onAudit) {
  const [sheet, setSheet] = useState(null)
  const [status, setStatus] = useState('')
  const [syncLog, setSyncLog] = useState([])

  useEffect(() => {
    if (!token) return
    adminFetchBioSheet(token).then(setSheet).catch(console.error)
  }, [token])

  async function handleImport(file) {
    setStatus('Reading file...')
    setSyncLog([])
    try {
      const ab = await file.arrayBuffer()
      const wb = XLSX.read(ab, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 })

      let reportDate = todayIST()
      for (let i = 0; i < Math.min(8, raw.length); i++) {
        const joined = raw[i].join(' ')
        const m = joined.match(/Report\s*Date\s*[:\-]\s*([\d]{1,2}[-/][A-Za-z\d]{2,3}[-/][\d]{2,4})/i) || joined.match(/([\d]{2}[-/][A-Za-z]{3}[-/][\d]{4})/)
        if (m) { reportDate = parseBioDate(m[1], todayIST()); break }
      }

      let headerIdx = 0
      for (let i = 0; i < Math.min(10, raw.length); i++) {
        const cells = raw[i].map(c => String(c).toLowerCase().trim())
        if (cells.some(c => ['emp.code', 'empcode', 'emp code', 'arr.time', 'arrtime'].some(k => c.includes(k)))) { headerIdx = i; break }
      }
      const headers = raw[headerIdx].map(c => String(c).trim())
      const dataRows = []
      for (let i = headerIdx + 1; i < raw.length; i++) {
        const r = raw[i]
        if (!r || r.every(c => !c)) continue
        const joined = r.map(c => String(c)).join(' ').toLowerCase()
        if (/page no|approved by|total present|total absent/.test(joined)) continue
        const obj = {}
        headers.forEach((h, idx) => { obj[h] = r[idx] ?? '' })
        dataRows.push(obj)
      }
      if (!dataRows.length) { setStatus('No data rows found.'); return }
      setStatus(`Parsed ${dataRows.length} rows · syncing...`)

      const empsSnap = [...employees].map(em => ({ ...em }))
      let { byCode, byName } = buildEmpMaps(empsSnap)
      const log = []
      let synced = 0, skipped = 0
      const records = []
      const attMap = { ...attendance }

      for (let idx = 0; idx < dataRows.length; idx++) {
        const row = dataRows[idx]
        const g = (...k) => gField(row, ...k)
        const empCodeRaw = normCode(g('empCode', 'Emp.Code', 'EmpCode', 'Emp Code', 'EmployeeCode', 'EMP CODE', 'EMP.CODE'))
        const empNameRaw = g('name', 'Name', 'Employee Name', 'EmployeeName', 'EMP NAME')
        const arrTime = parseBioTime(g('arrTime', 'Arr.Time', 'ArrTime', 'Arr Time', 'Arrival', 'INTIME', 'IN TIME', 'In Time'))
        const deptTime = parseBioTime(g('deptTime', 'Dept Time', 'DeptTime', 'DepTime', 'Departure', 'OUTTIME', 'OUT TIME', 'Out Time'))
        const lateHrs = g('lateHrs', 'Late Hrs', 'LateHrs', 'LATE HRS')
        const earlyHrs = g('earlyHrs', 'Early Hrs', 'EarlyHrs')
        const wrkHrs = g('wrkHrs', 'WrkHrs', 'Wrk Hrs', 'Work Hrs', 'WorkHrs')
        const otHrs = g('otHrs', 'O.Time', 'OTime', 'Overtime', 'OT', 'O.T')
        const bioStatusRaw = g('status', 'Status', 'STATUS', 'Att. Status')
        const shift = g('shift', 'Shift', 'SHIFT')
        const startTime = g('startTime', 'Start Time', 'StartTime', 'ShiftStart')
        const inTemp = g('inTemp', 'In Temp', 'InTemp', 'IN TEMP')
        const outTemp = g('outTemp', 'Out Temp', 'OutTemp', 'OUT TEMP')
        const remark = g('remark', 'Remark', 'Remarks', 'REMARK')
        const cardNo = g('cardNo', 'CardNo', 'Card No', 'CARDNO')
        const desig = g('desig', 'Designation', 'Desig', 'DESIGNATION')
        const bioStatus = mapBioStatus(bioStatusRaw)

        if (!empCodeRaw && !empNameRaw) { skipped++; continue }
        let emp = byCode[empCodeRaw] || byCode[String(parseInt(empCodeRaw, 10) || 0)] || byCode[empCodeRaw.replace(/^0+/, '') || '0']
        if (!emp && empNameRaw.length > 2) emp = byName[empNameRaw.toLowerCase()]
        if (!emp && empNameRaw.length > 2) {
          const fw = empNameRaw.toLowerCase().split(/\s+/)[0]
          if (fw.length > 2) emp = empsSnap.find(x => x.name && x.name.toLowerCase().startsWith(fw))
        }

        if (emp && empCodeRaw && normCode(emp.empNum) !== empCodeRaw) {
          try {
            const oldCode = emp.empNum || '(none)'
            const updated = await adminUpdateEmployee(token, emp.id, { ...emp, empNum: empCodeRaw })
            const si = empsSnap.findIndex(x => x.id === emp.id)
            if (si >= 0) empsSnap[si] = updated
            emp = updated
            ;({ byCode, byName } = buildEmpMaps(empsSnap))
            log.push({ type: 'ok', msg: `Updated emp code: ${oldCode} to ${empCodeRaw} (${emp.name})` })
          } catch (err) { console.error('Could not update emp code:', err) }
        }
        if (!emp && empCodeRaw && empCodeRaw !== '0') {
          try {
            const pin = empCodeRaw.slice(-4).padStart(4, '0')
            // Biometric device exports genuinely carry no company field (unlike the
            // leave-balance import, which does) — COMPANIES[0] here is a real data gap,
            // not a bug. Admin should correct the company from the Employees screen for
            // anyone auto-created this way.
            const createdEmp = await adminCreateEmployee(token, { name: empNameRaw || empCodeRaw, pin, company: COMPANIES[0], empNum: empCodeRaw, jobTitle: desig || '' })
            empsSnap.push(createdEmp)
            emp = createdEmp
            ;({ byCode, byName } = buildEmpMaps(empsSnap))
            log.push({ type: 'ok', msg: `Auto-created: ${emp.name} (${empCodeRaw})` })
          } catch (err) { console.error('Could not auto-create employee:', err) }
        }
        if (!emp) { log.push({ type: 'skip', msg: `Row ${idx + 1}: no match` }); skipped++; continue }

        const existing = { ...(attMap[`${emp.id}_${reportDate}`] || { empId: emp.id, date: reportDate }) }
        // Always record what the device said (P3-10/P3-11 — the raw reading, for the
        // comparison view), but only let it become the OFFICIAL in/out/status when
        // nothing has already claimed the day as an app punch or a manual admin
        // correction — otherwise this import would silently overwrite a real,
        // GPS-verified punch with no record anything had changed (the exact bug
        // plan.md flagged as a known follow-up).
        if (arrTime) existing.bioInTime = arrTime
        if (deptTime) existing.bioOutTime = deptTime
        const protectedSource = existing.officialSource === 'app' || existing.officialSource === 'manual'
        if (!protectedSource) {
          if (arrTime) existing.inTime = arrTime
          if (deptTime) existing.outTime = deptTime
        }
        if (inTemp) existing.inTemp = inTemp
        if (outTemp) existing.outTemp = outTemp
        if (remark) existing.remark = remark
        if (lateHrs) existing.lateHrs = lateHrs
        if (earlyHrs) existing.earlyHrs = earlyHrs
        if (wrkHrs) existing.bioWrkHrs = wrkHrs
        if (otHrs) existing.bioOT = otHrs
        if (shift) existing.shift = shift
        if (startTime) existing.shiftStart = startTime
        if (cardNo) existing.cardNo = cardNo
        if (desig && !existing.designation) existing.designation = desig
        existing.bioStatusRaw = bioStatusRaw
        existing.bioSource = file.name
        if (!protectedSource) {
          existing.officialSource = 'biometric'
          if (existing.leaveType) {
            const lt = findLeaveType(existing.leaveType)
            existing.status = lt && !lt.present ? 'Leave' : calcStatus(existing, stdHours, existing.dayType)
          } else if (bioStatus) existing.status = bioStatus
          else existing.status = calcStatus(existing, stdHours, existing.dayType)
        }

        attMap[`${emp.id}_${reportDate}`] = existing
        records.push(existing)
        synced++
        log.push({ type: 'ok', msg: `${emp.name} (${empCodeRaw}) | ${reportDate} | ${existing.status}` })
      }

      if (empsSnap.length !== employees.length || empsSnap.some((em, i) => employees[i] && em.id === employees[i].id && em.empNum !== employees[i].empNum)) {
        setEmployees(empsSnap)
      }
      if (records.length) await bulkUpsertAttendance(records)

      const bioData = { filename: file.name, reportDate, rows: dataRows, cols: headers.filter(Boolean), importedAt: new Date().toISOString(), synced, skipped }
      setSheet(bioData)
      await adminSetBioSheet(token, file.name, headers.filter(Boolean), dataRows, reportDate, synced, skipped)
      setSyncLog(log)
      setStatus(`Synced ${synced} records · ${skipped} skipped · Date: ${reportDate}`)
      onAudit?.('IMPORT', `Daily bio: ${file.name} · ${synced} synced`, 'admin')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
      console.error(err)
    }
  }

  async function removeSheet() {
    try {
      await adminClearBioSheet(token)
      setSheet(null); setStatus(''); setSyncLog([])
    } catch (err) { alert(err.message) }
  }

  function exportSheet() {
    if (!sheet) return
    const ws = XLSX.utils.json_to_sheet(sheet.rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'DailyBio')
    XLSX.writeFile(wb, 'daily_bio_export.xlsx')
  }

  return { sheet, status, syncLog, handleImport, removeSheet, exportSheet }
}
