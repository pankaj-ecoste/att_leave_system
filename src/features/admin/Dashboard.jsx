import { useEffect } from 'react'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { getShiftInfo } from '../../lib/constants'
import { calcRawHrs, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'

export function Dashboard({ employees, leaves, attendanceHook, stdHours }) {
  const today = todayIST()
  const { attendance, fetchRange } = attendanceHook

  useEffect(() => {
    fetchRange({ from: today, to: today })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeEmps = employees.filter(e => e.active)
  const todayRecs = Object.values(attendance).filter(r => r.date === today)
  const stats = {
    active: activeEmps.length,
    present: todayRecs.filter(r => r.status === 'Present').length,
    absent: todayRecs.filter(r => r.status === 'Absent').length,
    leave: todayRecs.filter(r => r.status === 'Leave').length,
    halfDay: todayRecs.filter(r => r.status === 'Half Day').length,
    wfh: todayRecs.filter(r => r.wfh).length,
    onDuty: todayRecs.filter(r => r.onDuty).length,
    pending: leaves.filter(l => l.status === 'Pending').length,
  }

  // P3-13 — adoption: of today's records with any punch recorded at all (either
  // source), what share is actually coming from the app vs still relying on the
  // biometric device import. officialSource is only set once one of the two sources
  // has actually written to the record (P3-10) — records with neither yet are excluded
  // rather than counted as "biometric" by default.
  const sourced = todayRecs.filter(r => r.officialSource)
  const appSourced = sourced.filter(r => r.officialSource === 'app').length
  const adoptionPct = sourced.length ? Math.round((appSourced / sourced.length) * 100) : 0

  return (
    <>
      <h2 className="text-white font-bold text-lg">Today's Summary — {today}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Active" value={stats.active} color="indigo" sub="Registered employees" />
        <StatCard label="Present" value={stats.present} color="emerald" sub="Punched in today" />
        <StatCard label="Absent" value={stats.absent} color="red" sub="No punch today" />
        <StatCard label="On Leave" value={stats.leave} color="amber" sub="Approved leave" />
        <StatCard label="Half Day" value={stats.halfDay} color="yellow" sub="Below std hours" />
        <StatCard label="WFH" value={stats.wfh} color="cyan" sub="Work from home" />
        <StatCard label="On Duty" value={stats.onDuty} color="purple" sub="Out on duty" />
        <StatCard label="Pending" value={stats.pending} color="orange" sub="Leave requests" />
        <StatCard label="App Adoption" value={`${adoptionPct}%`} color="blue" sub={sourced.length ? `${appSourced}/${sourced.length} via the app today` : 'No punches recorded yet'} />
      </div>
      <Card>
        <h3 className="text-white font-semibold mb-3">Today's Attendance Details</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-white/70 min-w-[700px]">
            <thead><tr className="border-b border-white/10">
              {['Employee', 'Emp Code', 'Dept', 'Shift', 'Manager', 'In', 'Out', 'Net Hrs', 'OT', 'Status'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody>{activeEmps.map(e => {
              const r = attendance[`${e.id}_${today}`] || {}
              const net = Math.max(0, calcRawHrs(r.inTime, r.outTime))
              const sh = getShiftInfo(r, e)
              return (
                <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-2.5 pr-4 font-medium text-white/80">{e.name}</td>
                  <td className="py-2.5 pr-4 text-white/30">{e.empNum || '--'}</td>
                  <td className="py-2.5 pr-4 text-white/30">{e.dept || '--'}</td>
                  <td className="py-2.5 pr-4">{sh.id !== 'none' && <span className="text-xs font-semibold px-2 py-0.5 rounded whitespace-nowrap" style={{ background: sh.color + '33', color: sh.color, border: `1px solid ${sh.color}55` }}>{sh.label}</span>}</td>
                  <td className="py-2.5 pr-4 text-white/30">{e.manager || '--'}</td>
                  <td className="py-2.5 pr-4 font-mono text-emerald-400">{r.inTime || '--'}</td>
                  <td className="py-2.5 pr-4 font-mono text-red-400">{r.outTime || '--'}</td>
                  <td className="py-2.5 pr-4">{fmtHrs(net)}</td>
                  <td className="py-2.5 pr-4 text-indigo-300">{net > stdHours ? fmtHrs(net - stdHours) : '--'}</td>
                  <td className="py-2.5"><Badge status={r.status || 'Absent'} /></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
