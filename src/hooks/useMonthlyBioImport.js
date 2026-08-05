import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { adminCreateEmployee, adminUpdateEmployee } from '../api/employees'
import { adminFetchMonthlySheet, adminSetMonthlySheet, adminClearMonthlySheet } from '../api/imports'
import { parseBioTime, normCode, buildEmpMaps } from '../lib/bioImport'
import { calcStatus } from '../lib/datetime'
import { COMPANIES, MONTHS, findLeaveType } from '../lib/constants'
import { fmt2 } from '../lib/format'

const cs = c => String(c || '').trim()

function isEmpRow(row) {
  for (let ci = 0; ci < Math.min(5, row.length); ci++) {
    const v = cs(row[ci])
    if (!/^\d{4,}$/.test(v)) continue
    for (let ni = ci + 1; ni < Math.min(ci + 10, row.length); ni++) {
      const nv = cs(row[ni])
      if (nv && nv.length > 2 && /[A-Za-z]/.test(nv) && !/^(empcode|name|present|absent|department|company|branch|desig|arrived|dept|working|status|shift|leave|paid)/i.test(nv)) {
        return { empCodeCol: ci, nameCol: ni, empCode: v, name: nv }
      }
    }
  }
  return null
}
function getDayColMap(row) {
  const map = {}
  row.forEach((c, ci) => {
    let n = null
    if (typeof c === 'number' && c >= 1 && c <= 31) n = Math.round(c)
    else { const v = cs(c); const p = parseInt(v); if (!isNaN(p) && p >= 1 && p <= 31 && (v === String(p) || v === fmt2(p))) n = p }
    if (n !== null && !map[n]) map[n] = ci
  })
  return Object.keys(map).length >= 15 ? map : null
}
function getRowType(row) {
  const v = cs(row[0]).toLowerCase()
  if (!v) return null
  if (v.includes('arrived') || v.includes('arr time') || v.includes('in time')) return 'arr'
  if (v.includes('dept') || v.includes('out time') || v.includes('dep.')) return 'dep'
  if (v.includes('working hrs') || v.includes('work hrs') || v.includes('wrkhrs')) return 'wrk'
  if (v.includes('o.time') || v.includes('o.times') || v.includes('ot hrs') || v.includes('overtime')) return 'ot'
  if (v.includes('status')) return 'status'
  if (v.includes('shift')) return 'shift'
  return null
}

// Excel importer #3 — the densest format: each employee spans several rows (one per
// metric — arrival, departure, work hours, overtime, status, shift) with a column per
// day of the month (the "MnPerformance" grid format).
export function useMonthlyBioImport(token, employees, setEmployees, attendance, bulkUpsertAttendance, stdHours, onAudit) {
  const [sheet, setSheet] = useState(null)
  const [status, setStatus] = useState('')
  const [syncLog, setSyncLog] = useState([])

  useEffect(() => {
    if (!token) return
    adminFetchMonthlySheet(token).then(setSheet).catch(console.error)
  }, [token])

  async function handleImport(file) {
    setStatus('Reading file...')
    setSyncLog([])
    try {
      const ab = await file.arrayBuffer()
      const wb = XLSX.read(ab, { type: 'array', cellDates: false, raw: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rawStr = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1, raw: false, blankrows: true })
      const rawNum = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1, raw: true, blankrows: true })
      const raw = rawStr.map((row, ri) => row.map((c, ci) => {
        const num = rawNum[ri] ? rawNum[ri][ci] : undefined
        return typeof num === 'number' ? num : c
      }))

      let reportMonth = new Date().getMonth() + 1, reportYear = new Date().getFullYear()
      for (let i = 0; i < Math.min(5, raw.length); i++) {
        const joined = raw[i].map(c => cs(c)).join(' ')
        const m = joined.match(/(\d{2})-(\d{2})-(\d{4})/)
        if (m) { reportMonth = parseInt(m[2]); reportYear = parseInt(m[3]); break }
        const m2 = joined.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})/i)
        if (m2) { const mi = MONTHS.findIndex(mn => mn.toLowerCase() === m2[1].toLowerCase().slice(0, 3)); if (mi >= 0) { reportMonth = mi + 1; reportYear = parseInt(m2[2]); break } }
      }
      const daysInMonth = new Date(reportYear, reportMonth, 0).getDate()

      const log = [`File: ${raw.length} rows · ${MONTHS[reportMonth - 1]} ${reportYear} (${daysInMonth} days)`].map(msg => ({ type: 'ok', msg }))
      let synced = 0, skipped = 0
      const records = []
      const attMap = { ...attendance }
      const empsSnap = [...employees].map(em => ({ ...em }))
      let { byCode, byName } = buildEmpMaps(empsSnap)
      const rebuildMaps = () => { ({ byCode, byName } = buildEmpMaps(empsSnap)) }

      let i = 0
      while (i < raw.length) {
        const empInfo = isEmpRow(raw[i])
        if (!empInfo) { i++; continue }

        const empCodeRaw = normCode(empInfo.empCode)
        const empNameRaw = empInfo.name
        const empRow = raw[i]
        const afterName = empRow.slice(empInfo.nameCol + 1).map(c => cs(c)).filter(c => c !== '')
        const totalPresent = parseInt(afterName[0]) || 0
        const totalWO = parseInt(afterName[2]) || 0
        const totalAbsent = parseInt(afterName[3]) || 0
        const totalLeave = parseInt(afterName[4]) || 0
        const workHrsTotal = afterName[7] || ''
        const ovTimTotal = afterName[8] || ''

        let dayColMap = null
        let arrRow = null, depRow = null, wrkRow = null, otRow = null, stRow = null, shRow = null
        const debugRows = []

        for (let j = i + 1; j < Math.min(i + 20, raw.length); j++) {
          const row = raw[j]
          if (isEmpRow(row)) break
          const joined = row.map(c => cs(c)).join('').trim()
          debugRows.push(`j${j}:[${row.slice(0, 6).map(c => cs(c)).join('|')}]`)
          if (!joined) continue
          if (!dayColMap) { const dm = getDayColMap(row); if (dm) { dayColMap = dm; continue } }
          if (dayColMap) {
            const rt = getRowType(row)
            if (rt === 'arr' && !arrRow) arrRow = row
            else if (rt === 'dep' && !depRow) depRow = row
            else if (rt === 'wrk' && !wrkRow) wrkRow = row
            else if (rt === 'ot' && !otRow) otRow = row
            else if (rt === 'status' && !stRow) stRow = row
            else if (rt === 'shift' && !shRow) shRow = row
          }
        }
        i++

        if (!dayColMap) {
          log.push({ type: 'skip', msg: `${empNameRaw} (${empCodeRaw}) · No day-header found. ${debugRows.slice(0, 3).join(' || ')}` })
          skipped++; continue
        }

        let emp = byCode[empCodeRaw] || byCode[String(parseInt(empCodeRaw, 10) || 0)] || byCode[empCodeRaw.replace(/^0+/, '') || '0']
        if (!emp && empNameRaw.length > 2) emp = byName[empNameRaw.toLowerCase()]
        if (!emp && empNameRaw.length > 2) { const fw = empNameRaw.toLowerCase().split(/\s+/)[0]; if (fw.length > 2) emp = empsSnap.find(x => x.name && x.name.toLowerCase().startsWith(fw)) }

        if (emp && empCodeRaw && normCode(emp.empNum) !== empCodeRaw) {
          try {
            const oldCode = emp.empNum || '(none)'
            const updated = await adminUpdateEmployee(token, emp.id, { ...emp, empNum: empCodeRaw })
            const si = empsSnap.findIndex(x => x.id === emp.id)
            if (si >= 0) empsSnap[si] = updated
            emp = updated; rebuildMaps()
            log.push({ type: 'ok', msg: `Updated emp code: ${oldCode} to ${empCodeRaw} (${emp.name})` })
          } catch (err) { console.error('Could not update emp code:', err) }
        }
        if (!emp && empCodeRaw && empCodeRaw !== '0') {
          try {
            const pin = empCodeRaw.slice(-4).padStart(4, '0')
            // Same data gap as the daily bio import — this grid format has no company
            // column either. COMPANIES[0] here is honest fallback, not a bug to "fix".
            const createdEmp = await adminCreateEmployee(token, { name: empNameRaw || empCodeRaw, pin, company: COMPANIES[0], empNum: empCodeRaw })
            empsSnap.push(createdEmp); emp = createdEmp; rebuildMaps()
            log.push({ type: 'ok', msg: `Auto-created: ${emp.name} (${empCodeRaw})` })
          } catch (err) { console.error('Could not auto-create employee:', err) }
        }
        if (!emp) { log.push({ type: 'skip', msg: `No match: ${empNameRaw} (${empCodeRaw})` }); skipped++; continue }

        let daysSynced = 0
        for (let d = 1; d <= daysInMonth; d++) {
          const ci = dayColMap[d]
          if (ci === undefined) continue
          const arrRaw = cs(arrRow ? arrRow[ci] : '')
          const depRaw = cs(depRow ? depRow[ci] : '')
          const wrkRaw = cs(wrkRow ? wrkRow[ci] : '')
          const otRaw = cs(otRow ? otRow[ci] : '')
          const stRaw = cs(stRow ? stRow[ci] : '')
          const shRaw = cs(shRow ? shRow[ci] : '')
          if (!arrRaw && !depRaw && !stRaw) continue
          const dateStr = `${reportYear}-${fmt2(reportMonth)}-${fmt2(d)}`
          const existing = { ...(attMap[`${emp.id}_${dateStr}`] || { empId: emp.id, date: dateStr }) }
          const inTime = parseBioTime(arrRaw)
          const outTime = parseBioTime(depRaw)
          // Same rule as the daily bio import (P3-10): always record the device's raw
          // reading, but don't let it overwrite an already-official app punch or manual
          // admin correction.
          if (inTime) existing.bioInTime = inTime
          if (outTime) existing.bioOutTime = outTime
          const protectedSource = existing.officialSource === 'app' || existing.officialSource === 'manual'
          if (!protectedSource) {
            if (inTime) existing.inTime = inTime
            if (outTime) existing.outTime = outTime
          }
          if (wrkRaw && wrkRaw !== '00:00') existing.bioWrkHrs = wrkRaw
          if (otRaw && otRaw !== '00:00') existing.bioOT = otRaw
          if (shRaw) existing.shift = shRaw
          existing.monthlySource = file.name
          const stUp = stRaw.toUpperCase()
          if (stUp === 'WO') existing.dayType = 'week_off'
          if (!protectedSource) {
            existing.officialSource = 'biometric'
            if (existing.leaveType) {
              const lt = findLeaveType(existing.leaveType)
              existing.status = lt && !lt.present ? 'Leave' : calcStatus(existing, stdHours, existing.dayType)
            } else if (stUp === 'P') existing.status = 'Present'
            else if (stUp === 'A') existing.status = 'Absent'
            else if (stUp === 'HL') existing.status = 'Half Day'
            else if (stUp === 'WO') existing.status = 'Week Off'
            else if (stUp === 'L') existing.status = 'Leave'
            else if (stUp === 'OD') { existing.status = 'Present'; existing.onDuty = true }
            else if (stUp === 'WFH') { existing.status = 'Present'; existing.wfh = true }
            else existing.status = calcStatus(existing, stdHours, existing.dayType)
          }
          attMap[`${emp.id}_${dateStr}`] = existing
          records.push(existing)
          daysSynced++; synced++
        }
        log.push({ type: 'ok', msg: `${emp.name} (${empCodeRaw}) · ${daysSynced}/${daysInMonth} days · P:${totalPresent} WO:${totalWO} A:${totalAbsent} L:${totalLeave} Hrs:${workHrsTotal} OT:${ovTimTotal}` })
      }

      if (empsSnap.length !== employees.length) setEmployees(empsSnap)
      if (records.length) await bulkUpsertAttendance(records)

      const sd = { filename: file.name, reportMonth, reportYear, importedAt: new Date().toISOString(), synced, skipped }
      setSheet(sd)
      await adminSetMonthlySheet(token, file.name, reportMonth, reportYear, synced, skipped)
      setSyncLog(log)
      setStatus(`Synced ${synced} day-records · ${skipped} skipped · ${MONTHS[reportMonth - 1]} ${reportYear}`)
      onAudit?.('IMPORT', `Monthly bio: ${file.name} · ${synced} day-records`, 'admin')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
      console.error(err)
    }
  }

  async function removeSheet() {
    try {
      await adminClearMonthlySheet(token)
      setSheet(null); setStatus(''); setSyncLog([])
    } catch (err) { alert(err.message) }
  }

  return { sheet, status, syncLog, handleImport, removeSheet }
}
