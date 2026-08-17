import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { MONTHS } from '../../lib/constants'
import { calcStatus, todayIST } from '../../lib/datetime'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayCellStyle(status, isWeekend, holiday, isFuture) {
  if (holiday) return { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/20' }
  if (isWeekend) return { bg: 'bg-white/3', text: 'text-white/20', border: 'border-white/5' }
  if (isFuture) return { bg: 'bg-white/5', text: 'text-white/40', border: 'border-white/10' }
  if (status === 'Present') return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/20' }
  if (status === 'Punched In') return { bg: 'bg-blue-500/15', text: 'text-blue-300', border: 'border-blue-500/20' }
  if (status === 'Half Day') return { bg: 'bg-yellow-500/15', text: 'text-yellow-300', border: 'border-yellow-500/20' }
  if (['Leave', 'WFH', 'On Duty'].includes(status)) return { bg: 'bg-indigo-500/15', text: 'text-indigo-300', border: 'border-indigo-500/20' }
  if (status === 'Absent') return { bg: 'bg-red-500/10', text: 'text-red-400/80', border: 'border-red-500/15' }
  return { bg: 'bg-white/5', text: 'text-white/40', border: 'border-white/10' }
}

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
          const status = rec.status || calcStatus(rec, stdHours, rec.dayType)
          const style = dayCellStyle(status, isWeekend && !rec.inTime, holiday, isFuture)
          return (
            <div key={d} className={`${style.bg} border ${style.border} rounded-lg p-1.5 text-center relative ${isToday ? 'ring-1 ring-indigo-400' : ''}`}>
              <p className={`text-xs font-bold ${style.text}`}>{d}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
