import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { MONTHS } from '../../lib/constants'
import { calcOvertimeHours, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'

// VB-2 (plan.md §11 Decision 13-15) — OT is tracking only, computed live from the same
// attendance data already loaded for this employee (useEmployeeAttendance fetches it in
// full), same as MonthlySummary.jsx does for its calendar. No separate API call.
export function MyOvertime({ currentUser, attendance, stdHours }) {
  const [sel, setSel] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() })
  const { month: m, year: y } = sel
  const daysInMonth = new Date(y, m, 0).getDate()

  const dayRows = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (dateStr > todayIST()) break
    const rec = attendance[`${currentUser.id}_${dateStr}`]
    if (!rec) continue
    const ot = calcOvertimeHours(rec, stdHours)
    if (ot > 0) dayRows.push({ date: dateStr, ot })
  }
  const monthTotal = dayRows.reduce((s, r) => s + r.ot, 0)

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="text-white font-semibold flex-1">My Overtime</h2>
        <select className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs" value={m} onChange={e => setSel(p => ({ ...p, month: +e.target.value }))}>
          {MONTHS.map((mn, i) => <option key={i + 1} value={i + 1}>{mn}</option>)}
        </select>
        <select className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs" value={y} onChange={e => setSel(p => ({ ...p, year: +e.target.value }))}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(yr => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </div>

      <div className="rounded-xl p-4 border bg-indigo-500/10 border-indigo-500/30 mb-4 text-center">
        <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Total Overtime — {MONTHS[m - 1]} {y}</p>
        <p className="text-white font-bold text-2xl">{fmtHrs(monthTotal)}</p>
        <p className="text-white/30 text-xs mt-1">Hours worked beyond {stdHours}h on a day. Tracking only — not yet part of payroll.</p>
      </div>

      {dayRows.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-4">No overtime recorded this month</p>
      ) : (
        <div className="space-y-1.5">
          {dayRows.slice().reverse().map(r => (
            <div key={r.date} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 border border-white/5">
              <span className="text-white/70 text-sm font-mono">{r.date}</span>
              <span className="text-indigo-300 text-sm font-medium">{fmtHrs(r.ot)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
