import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'
import { adminFetchAttendance } from '../../api/attendance'
import { adminFetchLeaves } from '../../api/leave'
import { adminGetAllLocationLogs } from '../../api/location'
import { MONTHS, findLeaveType, ACCEPTABLE_GPS_ACCURACY_M, APP_BIO_MISMATCH_THRESHOLD_MIN } from '../../lib/constants'
import { calcRawHrs, timeDiffMinutes, todayIST } from '../../lib/datetime'
import { fmt2 } from '../../lib/format'

// Exports are the one place that must NOT be capped by whatever's on screen (plan.md
// §8B S-2b) — the old app silently stopped at 200 rows while telling the user nothing
// (§4.5 #4). So this fetches fresh, for exactly the requested range, every time.
export function Reports({ token, employees, stdHours, onAudit }) {
  const [reportDate, setReportDate] = useState(todayIST())
  const [reportFrom, setReportFrom] = useState(todayIST())
  const [reportTo, setReportTo] = useState(todayIST())
  const [msg, setMsg] = useState('')
  const [dailyDate, setDailyDate] = useState(todayIST())
  const [dailyBusy, setDailyBusy] = useState(false)
  const [dailyMsg, setDailyMsg] = useState('')

  async function exportReport(type, from, to) {
    const map = await adminFetchAttendance(token, { from, to, limit: 100000 })
    const rows = Object.values(map).map(v => {
      const emp = employees.find(e => e.id === v.empId) || {}
      const raw = calcRawHrs(v.inTime, v.outTime)
      const deduct = v.leaveType ? findLeaveType(v.leaveType)?.deduct || 0 : 0
      const net = Math.max(0, raw - deduct)
      return {
        Date: v.date, 'Employee ID': emp.empNum || '', 'Employee Name': emp.name || '', Department: emp.dept || '',
        Designation: emp.jobTitle || '', Company: emp.company || '', 'Login Time': v.inTime || '', 'Logout Time': v.outTime || '',
        'Raw Hours': raw.toFixed(2), 'Total Hours': net.toFixed(2), Overtime: Math.max(0, net - stdHours).toFixed(2),
        Status: v.status || '', 'Leave Type': v.leaveType || '', 'Leave Reason': v.leaveReason || '',
        WFH: v.wfh ? 'Yes' : 'No', 'On Duty': v.onDuty ? 'Yes' : 'No', Location: v.inLocation || '', Remarks: '',
      }
    })
    if (!rows.length) { setMsg('No records found.'); return }
    downloadRows(rows, type, `attendance_${from}_${to}`)
    onAudit?.('REPORT', `Report ${from} to ${to}`, 'admin')
  }

  function downloadRows(rows, type, filenameBase) {
    if (type === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
      XLSX.writeFile(wb, `${filenameBase}.xlsx`)
    } else {
      const keys = Object.keys(rows[0])
      const csv = [keys.join(','), ...rows.map(r => keys.map(k => `"${r[k] ?? ''}"`).join(','))].join('\n')
      const a = document.createElement('a')
      a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
      a.download = `${filenameBase}.csv`
      a.click()
    }
  }

  // P4C-1..4 — daily report, 5 sheets. Every sheet is built from a fresh, server-side
  // fetch scoped to exactly `date` (P4C-3) — never from whatever attendance/leave state
  // happens to already be sitting in the admin panel's memory, same "not capped by
  // what's on screen" rule the single-day/range exports above already follow (S-2b).
  async function exportDailyReport(date) {
    setDailyBusy(true)
    setDailyMsg('')
    try {
      const [attMap, leaves, locLogs] = await Promise.all([
        adminFetchAttendance(token, { from: date, to: date, limit: 100000 }),
        adminFetchLeaves(token, { from: date, to: date, limit: 100000 }),
        adminGetAllLocationLogs(token, date),
      ])
      const attRows = Object.values(attMap)
      const empOf = id => employees.find(e => e.id === id) || {}

      // --- Summary ---
      const counts = { Present: 0, Absent: 0, 'Half Day': 0, Leave: 0, 'Half Day Leave': 0, WFH: 0, 'On Duty': 0, 'Week Off': 0, Holiday: 0 }
      for (const r of attRows) counts[r.status] = (counts[r.status] || 0) + 1
      const summaryRows = [
        { Metric: 'Report Date', Value: date },
        { Metric: 'Total Employees', Value: employees.filter(e => e.active).length },
        { Metric: 'Attendance Records', Value: attRows.length },
        ...Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => ({ Metric: k, Value: v })),
        { Metric: 'Leave Applications Filed', Value: leaves.length },
        { Metric: 'Location Log Entries', Value: locLogs.length },
      ]

      // --- Attendance ---
      const attendanceRows = attRows.map(v => {
        const emp = empOf(v.empId)
        const raw = calcRawHrs(v.inTime, v.outTime)
        const deduct = v.leaveType ? findLeaveType(v.leaveType)?.deduct || 0 : 0
        const net = Math.max(0, raw - deduct)
        return {
          'Employee ID': emp.empNum || '', 'Employee Name': emp.name || '', Department: emp.dept || '', Company: emp.company || '',
          'In Time': v.inTime || '', 'Out Time': v.outTime || '', 'Raw Hours': raw.toFixed(2), 'Net Hours': net.toFixed(2),
          Status: v.status || '', 'Day Part': v.dayPart !== 'full' ? v.dayPart : '', 'Leave Type': v.leaveType || '',
          Source: v.officialSource || v.source || '', 'App In': v.appInTime || '', 'Bio In': v.bioInTime || '',
        }
      })

      // --- Location Log ---
      const locationRows = locLogs.map(l => ({
        Time: new Date(l.capturedAt).toLocaleTimeString(), 'Employee ID': l.empNum || '', 'Employee Name': l.empName || '',
        Type: l.type, Location: l.latLon || '', Latitude: l.lat ?? '', Longitude: l.lon ?? '', 'Accuracy (m)': l.accuracyM ?? '',
      }))

      // --- Leave ---
      const leaveRows = leaves.map(l => ({
        'Employee Name': l.empName, Company: l.company || '', 'Leave Type': l.leaveType,
        'Day Part': l.dayPart !== 'full' ? l.dayPart : '', Status: l.status, Reason: l.reason || '',
      }))

      // --- Exceptions ---
      const exceptionRows = []
      for (const v of attRows) {
        const emp = empOf(v.empId)
        const who = { 'Employee ID': emp.empNum || '', 'Employee Name': emp.name || '' }
        if (v.inSiteId && v.inInsideGeofence === false) exceptionRows.push({ ...who, Exception: 'Outside office radius (punch in)', Detail: `${v.inDistanceM ?? '?'}m from site` })
        if (v.outSiteId && v.outInsideGeofence === false) exceptionRows.push({ ...who, Exception: 'Outside office radius (punch out)', Detail: `${v.outDistanceM ?? '?'}m from site` })
        if (v.inTime && !v.outTime && v.date !== todayIST()) exceptionRows.push({ ...who, Exception: 'Missing punch-out', Detail: `Punched in at ${v.inTime}, never punched out` })
        const inMismatch = timeDiffMinutes(v.appInTime, v.bioInTime)
        if (inMismatch !== null && inMismatch > APP_BIO_MISMATCH_THRESHOLD_MIN) exceptionRows.push({ ...who, Exception: 'App/biometric mismatch (in)', Detail: `App ${v.appInTime} vs Bio ${v.bioInTime} — ${inMismatch}min apart` })
        const outMismatch = timeDiffMinutes(v.appOutTime, v.bioOutTime)
        if (outMismatch !== null && outMismatch > APP_BIO_MISMATCH_THRESHOLD_MIN) exceptionRows.push({ ...who, Exception: 'App/biometric mismatch (out)', Detail: `App ${v.appOutTime} vs Bio ${v.bioOutTime} — ${outMismatch}min apart` })
        if (v.inAccuracyM > ACCEPTABLE_GPS_ACCURACY_M) exceptionRows.push({ ...who, Exception: 'Suspicious GPS accuracy (in)', Detail: `±${Math.round(v.inAccuracyM)}m` })
        if (v.outAccuracyM > ACCEPTABLE_GPS_ACCURACY_M) exceptionRows.push({ ...who, Exception: 'Suspicious GPS accuracy (out)', Detail: `±${Math.round(v.outAccuracyM)}m` })
      }

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attendanceRows.length ? attendanceRows : [{ Note: 'No attendance records for this date' }]), 'Attendance')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(locationRows.length ? locationRows : [{ Note: 'No location log entries for this date' }]), 'Location Log')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leaveRows.length ? leaveRows : [{ Note: 'No leave applications for this date' }]), 'Leave')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exceptionRows.length ? exceptionRows : [{ Note: 'No exceptions found for this date' }]), 'Exceptions')
      XLSX.writeFile(wb, `daily_report_${date}.xlsx`)
      onAudit?.('REPORT', `Daily report generated for ${date}`, 'admin')
    } catch (err) {
      setDailyMsg(err.message || 'Could not generate the daily report — please try again')
    } finally {
      setDailyBusy(false)
    }
  }

  return (
    <Card className="space-y-5">
      <h3 className="text-white font-semibold text-lg">Reports</h3>
      {msg && <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-300 text-sm">{msg}</div>}

      <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-2xl p-4 space-y-3">
        <h4 className="text-white font-medium text-sm">Daily Report — 5-Sheet Workbook</h4>
        <p className="text-white/40 text-xs">Summary · Attendance · Location Log · Leave · Exceptions (outside-office, missing punch-out, app/bio mismatch, low GPS accuracy) — all generated fresh for the exact date selected.</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[140px]"><Label>Date</Label><Input type="date" value={dailyDate} max={todayIST()} onChange={e => setDailyDate(e.target.value)} /></div>
          <Button className="text-xs" disabled={dailyBusy} onClick={() => exportDailyReport(dailyDate)}>{dailyBusy ? 'Generating...' : 'Download Daily Report'}</Button>
        </div>
        {dailyMsg && <p className="text-red-400 text-xs">{dailyMsg}</p>}
      </div>

      <div className="border border-white/10 rounded-2xl p-4 space-y-3">
        <h4 className="text-white/60 text-sm font-medium uppercase tracking-wide">Single Day</h4>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[140px]"><Label>Date</Label><Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} /></div>
          <Button className="text-xs" onClick={() => exportReport('xlsx', reportDate, reportDate)}>Export XLSX</Button>
          <Button variant="secondary" className="text-xs" onClick={() => exportReport('csv', reportDate, reportDate)}>Export CSV</Button>
        </div>
      </div>

      <div className="border border-white/10 rounded-2xl p-4 space-y-3">
        <h4 className="text-white/60 text-sm font-medium uppercase tracking-wide">Date Range</h4>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[140px]"><Label>From</Label><Input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></div>
          <div className="flex-1 min-w-[140px]"><Label>To</Label><Input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} /></div>
          <Button className="text-xs" onClick={() => exportReport('xlsx', reportFrom, reportTo)}>Export XLSX</Button>
          <Button variant="secondary" className="text-xs" onClick={() => exportReport('csv', reportFrom, reportTo)}>Export CSV</Button>
        </div>
      </div>

      <div className="border border-white/10 rounded-2xl p-4">
        <h4 className="text-white/60 text-sm font-medium uppercase tracking-wide mb-3">Quick Monthly</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {MONTHS.map((mn, i) => {
            const m = i + 1, y = new Date().getFullYear()
            const from = `${y}-${fmt2(m)}-01`, to = `${y}-${fmt2(m)}-${fmt2(new Date(y, m, 0).getDate())}`
            return (
              <div key={mn} className="flex items-center gap-1 bg-white/5 rounded-xl px-3 py-2 border border-white/10">
                <span className="text-white/60 text-xs flex-1">{mn} {y}</span>
                <button className="text-xs text-indigo-400 hover:text-indigo-300 font-medium" onClick={() => exportReport('xlsx', from, to)}>xlsx</button>
                <span className="text-white/10 mx-1">|</span>
                <button className="text-xs text-indigo-400 hover:text-indigo-300 font-medium" onClick={() => exportReport('csv', from, to)}>csv</button>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
