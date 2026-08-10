import { useEffect, useState } from 'react'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { getShiftInfo } from '../../lib/constants'
import { calcRawHrs, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'

// Predicate per attendance-based tile — 'pending' is handled separately below since it
// comes from leave requests, not today's attendance records.
const TILE_FILTERS = {
  present: r => r.status === 'Present',
  absent: r => r.status === 'Absent',
  leave: r => r.status === 'Leave',
  halfDay: r => r.status === 'Half Day',
  wfh: r => r.wfh,
  onDuty: r => r.onDuty,
}

const TILE_LABELS = { present: 'Present', absent: 'Absent', leave: 'On Leave', halfDay: 'Half Day', wfh: 'WFH', onDuty: 'On Duty', pending: 'Pending Leave Requests' }

export function Dashboard({ employees, leaves, attendanceHook, stdHours, todaysBirthdays = [], markBirthdayWished }) {
  const today = todayIST()
  const { attendance, fetchRange } = attendanceHook
  const [filter, setFilter] = useState(null) // null | one of TILE_FILTERS' keys | 'pending'

  useEffect(() => {
    fetchRange({ from: today, to: today })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeEmps = employees.filter(e => e.active)
  const todayRecs = Object.values(attendance).filter(r => r.date === today)
  const pendingLeaves = leaves.filter(l => l.status === 'Pending')
  const stats = {
    active: activeEmps.length,
    present: todayRecs.filter(TILE_FILTERS.present).length,
    absent: todayRecs.filter(TILE_FILTERS.absent).length,
    leave: todayRecs.filter(TILE_FILTERS.leave).length,
    halfDay: todayRecs.filter(TILE_FILTERS.halfDay).length,
    wfh: todayRecs.filter(TILE_FILTERS.wfh).length,
    onDuty: todayRecs.filter(TILE_FILTERS.onDuty).length,
    pending: pendingLeaves.length,
  }

  function toggleFilter(key) {
    setFilter(f => (f === key ? null : key))
  }

  const shownEmps = filter && filter !== 'pending'
    ? activeEmps.filter(e => TILE_FILTERS[filter]((attendance[`${e.id}_${today}`] || {})))
    : activeEmps

  return (
    <>
      <h2 className="text-white font-bold text-lg">Today's Summary — {today}</h2>

      {todaysBirthdays.length > 0 && (
        // VA-6 (plan.md §11) — a reminder to post in the WhatsApp group, not an
        // approval queue, so "mark as done" is a plain acknowledgement, not a decision.
        <Card>
          <p className="text-amber-300 text-xs font-semibold mb-2">🎂 {todaysBirthdays.length} birthday{todaysBirthdays.length !== 1 ? 's' : ''} today</p>
          <div className="space-y-1">
            {todaysBirthdays.map(b => (
              <div key={b.empId} className="flex items-center justify-between text-xs">
                <span className="text-white/70">{b.name} — {b.company?.split(' ')[0]}</span>
                {b.acked ? (
                  <span className="text-emerald-400">Wished ✓</span>
                ) : (
                  <Button variant="secondary" className="text-xs py-0.5 px-2" onClick={() => markBirthdayWished(b.empId)}>Mark as done</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Active" value={stats.active} color="indigo" sub="Registered employees" onClick={() => setFilter(null)} active={!filter} />
        <StatCard label="Present" value={stats.present} color="emerald" sub="Punched in today" onClick={() => toggleFilter('present')} active={filter === 'present'} />
        <StatCard label="Absent" value={stats.absent} color="red" sub="No punch today" onClick={() => toggleFilter('absent')} active={filter === 'absent'} />
        <StatCard label="On Leave" value={stats.leave} color="amber" sub="Approved leave" onClick={() => toggleFilter('leave')} active={filter === 'leave'} />
        <StatCard label="Half Day" value={stats.halfDay} color="yellow" sub="Below std hours" onClick={() => toggleFilter('halfDay')} active={filter === 'halfDay'} />
        <StatCard label="WFH" value={stats.wfh} color="cyan" sub="Work from home" onClick={() => toggleFilter('wfh')} active={filter === 'wfh'} />
        <StatCard label="On Duty" value={stats.onDuty} color="purple" sub="Out on duty" onClick={() => toggleFilter('onDuty')} active={filter === 'onDuty'} />
        <StatCard label="Pending" value={stats.pending} color="orange" sub="Leave requests" onClick={() => toggleFilter('pending')} active={filter === 'pending'} />
      </div>

      {filter === 'pending' ? (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">{TILE_LABELS.pending}</h3>
            <Button variant="secondary" className="text-xs" onClick={() => setFilter(null)}>Clear filter</Button>
          </div>
          {pendingLeaves.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-4">No pending leave requests</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-white/70 min-w-[600px]">
                <thead><tr className="border-b border-white/10">
                  {['Employee', 'Leave Type', 'Date', 'Day Part', 'Reason'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}
                </tr></thead>
                <tbody>{pendingLeaves.map(l => {
                  return (
                    <tr key={l.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-white/80">{l.empName || '--'}</td>
                      <td className="py-2.5 pr-4">{l.leaveType}</td>
                      <td className="py-2.5 pr-4 font-mono">{l.date}</td>
                      <td className="py-2.5 pr-4 text-white/30">{l.dayPart && l.dayPart !== 'full' ? l.dayPart : '--'}</td>
                      <td className="py-2.5 pr-4 text-white/30">{l.reason || '--'}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">{filter ? `Today's Attendance — ${TILE_LABELS[filter]}` : "Today's Attendance Details"}</h3>
            {filter && <Button variant="secondary" className="text-xs" onClick={() => setFilter(null)}>Clear filter</Button>}
          </div>
          {shownEmps.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-4">No employees match this filter</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-white/70 min-w-[700px]">
                <thead><tr className="border-b border-white/10">
                  {['Employee', 'Emp Code', 'Dept', 'Shift', 'Manager', 'In', 'Out', 'Net Hrs', 'OT', 'Status'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}
                </tr></thead>
                <tbody>{shownEmps.map(e => {
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
          )}
        </Card>
      )}
    </>
  )
}
