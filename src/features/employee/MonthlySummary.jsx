import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { MONTHS, findLeaveType, PRESENT_STATUS, PUNCHED_IN_STATUS, HALF_DAY_STATUS, LEAVE_STATUS, HALF_DAY_LEAVE_STATUS, WFH_STATUS, ON_DUTY_STATUS, ABSENT_STATUS } from '../../lib/constants'
import { calcStatus, todayIST } from '../../lib/datetime'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Colors alone don't survive a small box on a phone screen at low opacity — every
// status used to render as the same washed-out teal (team feedback, plan.md §34).
// Every status now gets its own hue AND a short in-box code so it reads without
// having to compare shades. Codes deliberately stay generic (L / HL), not per-leave-type
// (SL/CL/EL/...) — team asked for the simple version over the more granular one.
function dayCellStyle(status, isWeekend, holiday, isFuture) {
  if (holiday) return { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30', label: 'H' }
  if (isWeekend) return { bg: 'bg-white/3', text: 'text-white/20', border: 'border-white/5', label: null }
  if (isFuture) return { bg: 'bg-white/5', text: 'text-white/40', border: 'border-white/10', label: null }
  if (status === PRESENT_STATUS) return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30', label: null }
  if (status === PUNCHED_IN_STATUS) return { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30', label: 'IN' }
  // Half Day (short hours, no leave applied) vs Half Day Leave (a leave type applied as
  // half day) both show "HL" per team's ask, but keep distinct colors so the two causes
  // can still be told apart at a glance.
  if (status === HALF_DAY_STATUS) return { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/30', label: 'HL' }
  if (status === HALF_DAY_LEAVE_STATUS) return { bg: 'bg-violet-500/20', text: 'text-violet-300', border: 'border-violet-500/30', label: 'HL' }
  if (status === LEAVE_STATUS) return { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/30', label: 'L' }
  if (status === WFH_STATUS) return { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30', label: 'WH' }
  if (status === ON_DUTY_STATUS) return { bg: 'bg-teal-500/20', text: 'text-teal-300', border: 'border-teal-500/30', label: 'OD' }
  if (status === ABSENT_STATUS) return { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/30', label: 'A' }
  return { bg: 'bg-white/5', text: 'text-white/40', border: 'border-white/10', label: null }
}

const LEGEND = [
  { swatch: 'bg-emerald-400', label: 'Present' },
  { swatch: 'bg-yellow-400', label: 'Half Day' },
  { swatch: 'bg-violet-400', label: 'Half Day Leave' },
  { swatch: 'bg-indigo-400', label: 'Leave (L)' },
  { swatch: 'bg-cyan-400', label: 'WFH' },
  { swatch: 'bg-teal-400', label: 'On Duty' },
  { swatch: 'bg-red-400', label: 'Absent' },
  { swatch: 'bg-amber-400', label: 'Holiday' },
  { swatch: 'bg-orange-400', label: 'P1/P2 = Partial Leave (1hr/2hr)' },
]

export function MonthlySummary({ currentUser, attendance, stdHours, holidays }) {
  const [sel, setSel] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() })
  const { month: m, year: y } = sel
  const today = todayIST()
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstDay = new Date(y, m - 1, 1).getDay()
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="text-white font-semibold flex-1">Monthly Attendance</h2>
        <select className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs" value={m} onChange={e => setSel(p => ({ ...p, month: +e.target.value }))}>
          {MONTHS.map((mn, i) => <option key={i + 1} value={i + 1}>{mn}</option>)}
        </select>
        <select className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs" value={y} onChange={e => setSel(p => ({ ...p, year: +e.target.value }))}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(yr => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-4 text-center text-white/30 text-xs font-medium pb-1 border-b border-white/10">
        {WEEKDAY_LABELS.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />
          const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const rec = attendance[`${currentUser.id}_${dateStr}`] || {}
          const isToday = dateStr === today
          const isFuture = dateStr > today
          const isWeekend = new Date(y, m - 1, d).getDay() === 0 || new Date(y, m - 1, d).getDay() === 6
          const holiday = holidays.find(h => h.date === dateStr)
          // Always live, never the stored rec.status — see AttendanceHistory.jsx for why.
          const status = calcStatus(rec, stdHours, rec.dayType)
          const style = dayCellStyle(status, isWeekend && !rec.inTime, holiday, isFuture)
          // A Partial Leave (1hr/2hr) doesn't get its own calcStatus outcome — it still
          // settles into Present or Half Day depending on whether it fully covered the
          // shortfall (datetime.js calcStatus). Show it as a corner badge regardless, so
          // "a partial leave was used today" doesn't disappear once the day reads Present.
          const partialLt = rec.leaveType ? findLeaveType(rec.leaveType) : null
          const partialBadge = partialLt?.label === 'Partial Leave - 1 Hour' ? 'P1'
            : partialLt?.label === 'Partial Leave - 2 Hours' ? 'P2' : null
          return (
            <div key={d} className={`${style.bg} border ${style.border} rounded-lg p-1 text-center relative flex flex-col items-center justify-center min-h-[2.5rem] ${isToday ? 'ring-1 ring-indigo-400' : ''}`}>
              {partialBadge && <span className="absolute top-0.5 right-0.5 text-[8px] font-bold text-orange-300">{partialBadge}</span>}
              <p className={`text-xs font-bold leading-tight ${style.text}`}>{d}</p>
              {style.label && <p className={`text-[9px] font-semibold leading-tight ${style.text}`}>{style.label}</p>}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 pt-3 border-t border-white/10">
        {LEGEND.map(item => (
          <span key={item.label} className="flex items-center gap-1 text-[10px] text-white/50">
            <span className={`w-2 h-2 rounded-full ${item.swatch}`} />
            {item.label}
          </span>
        ))}
      </div>
    </Card>
  )
}
