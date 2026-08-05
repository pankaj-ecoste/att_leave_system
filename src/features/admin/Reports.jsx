import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'
import { adminFetchAttendance } from '../../api/attendance'
import { MONTHS, findLeaveType } from '../../lib/constants'
import { calcRawHrs, todayIST } from '../../lib/datetime'
import { fmt2 } from '../../lib/format'

// Exports are the one place that must NOT be capped by whatever's on screen (plan.md
// §8B S-2b) — the old app silently stopped at 200 rows while telling the user nothing
// (§4.5 #4). So this fetches fresh, for exactly the requested range, every time.
export function Reports({ token, employees, stdHours, onAudit }) {
  const [reportDate, setReportDate] = useState(todayIST())
  const [reportFrom, setReportFrom] = useState(todayIST())
  const [reportTo, setReportTo] = useState(todayIST())
  const [msg, setMsg] = useState('')

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

  return (
    <Card className="space-y-5">
      <h3 className="text-white font-semibold text-lg">Reports</h3>
      {msg && <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-300 text-sm">{msg}</div>}

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
