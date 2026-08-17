import { useEffect, useState } from 'react'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { getShiftInfo, requiresFieldNote } from '../../lib/constants'
import { calcRawHrs, calcOvertimeHours, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'
import { adminGetAllLocationLogs } from '../../api/location'

// Predicate per attendance-based tile — 'pending' is handled separately below since it
// comes from leave requests, not today's attendance records.
const TILE_FILTERS = {
  // "Present" here means "actually working today" (matches the tile's own subtitle,
  // "Punched in today") — covers someone still mid-shift ("Punched In"), someone who has
  // already completed their day ("Present"), and someone out on official duty
  // ("On Duty"), so the count never disagrees with what's visibly true in the table
  // below it. The row badge still shows the specific status — only this tile's count
  // merges them. See plan.md §12 V3 decisions 2 and 3.
  present: r => r.status === 'Present' || r.status === 'Punched In' || r.status === 'On Duty',
  // Mirrors the per-row table's own fallback (`r.status || 'Absent'`) — an employee with
  // no attendance record at all today is still Absent, not invisible to this tile.
  absent: r => (r.status || 'Absent') === 'Absent',
  leave: r => r.status === 'Leave',
  halfDay: r => r.status === 'Half Day',
  // Two different ways to be "WFH today": an approved WFH leave application for
  // someone who isn't normally remote (sets attendance.wfh), or an employee whose
  // permanent tag is WFH (plan.md §6B) simply punching in as usual — that punch never
  // touches attendance.wfh at all, so the tile used to miss every permanently-remote
  // employee entirely, counting only occasional WFH-leave days.
  wfh: (r, e) => r.wfh || e.workMode === 'wfh',
  onDuty: r => r.onDuty,
  // Employee-level tag, not a today's-attendance outcome like the others — the only
  // predicate here that looks at the employee rather than their record. plan.md §12 V3
  // decision 8.
  fieldStaff: (r, e) => requiresFieldNote(e.workMode),
}

const TILE_LABELS = { present: 'Present', absent: 'Absent', leave: 'On Leave', halfDay: 'Half Day', wfh: 'WFH', onDuty: 'On Duty', fieldStaff: 'Field Staff', pending: 'Pending Leave Requests' }

export function Dashboard({ token, employees, leaves, attendanceHook, stdHours, todaysBirthdays = [], markBirthdayWished }) {
  const today = todayIST()
  const { attendance, fetchRange } = attendanceHook
  const [filter, setFilter] = useState(null) // null | one of TILE_FILTERS' keys | 'pending'
  const [gpsTrails, setGpsTrails] = useState({}) // empId -> sorted array of today's 2-hourly pings
  const [trailEmp, setTrailEmp] = useState(null) // employee whose trail modal is open, or null

  useEffect(() => {
    fetchRange({ from: today, to: today })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The Field Staff tile is the one place admin checks a typed note against where GPS
  // actually put someone — the silent 2-hourly background pings (P3-14) are the only
  // source that can catch drift *during* the day, not just at punch in/out, so they're
  // only fetched when this tile is actually open, not on every dashboard load.
  useEffect(() => {
    if (filter !== 'fieldStaff' || !token) return
    adminGetAllLocationLogs(token, today).then(logs => {
      const byEmp = {}
      for (const log of logs) {
        if (log.type !== 'auto') continue // punch_in/punch_out already shown in their own columns
        ;(byEmp[log.empId] ||= []).push(log)
      }
      for (const empId in byEmp) byEmp[empId].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''))
      setGpsTrails(byEmp)
    }).catch(console.error)
  }, [filter, token, today])

  const activeEmps = employees.filter(e => e.active)
  // Every active employee counts toward the tiles below, not just the ones who already
  // have an attendance row today — someone who simply hasn't punched in yet has no row
  // at all, and used to be invisible to every tile (including Absent) as a result, even
  // though the table further down already correctly defaulted them to Absent. Same
  // `attendance[...] || {}` lookup the table uses, so the tiles and the table can never
  // disagree again.
  const todayRecordFor = e => attendance[`${e.id}_${today}`] || {}
  const pendingLeaves = leaves.filter(l => l.status === 'Pending')
  const stats = {
    active: activeEmps.length,
    present: activeEmps.filter(e => TILE_FILTERS.present(todayRecordFor(e), e)).length,
    absent: activeEmps.filter(e => TILE_FILTERS.absent(todayRecordFor(e), e)).length,
    leave: activeEmps.filter(e => TILE_FILTERS.leave(todayRecordFor(e), e)).length,
    halfDay: activeEmps.filter(e => TILE_FILTERS.halfDay(todayRecordFor(e), e)).length,
    wfh: activeEmps.filter(e => TILE_FILTERS.wfh(todayRecordFor(e), e)).length,
    onDuty: activeEmps.filter(e => TILE_FILTERS.onDuty(todayRecordFor(e), e)).length,
    fieldStaff: activeEmps.filter(e => TILE_FILTERS.fieldStaff(todayRecordFor(e), e)).length,
    pending: pendingLeaves.length,
  }

  function toggleFilter(key) {
    setFilter(f => (f === key ? null : key))
  }

  const shownEmps = filter && filter !== 'pending'
    ? activeEmps.filter(e => TILE_FILTERS[filter](todayRecordFor(e), e))
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
        <StatCard label="Field Staff" value={stats.fieldStaff} color="blue" sub="Note vs. GPS location" onClick={() => toggleFilter('fieldStaff')} active={filter === 'fieldStaff'} />
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
                {filter === 'fieldStaff' ? (
                  // plan.md §12 V3 decision 8 — Note (what they typed) and Location (what
                  // GPS actually captured) side by side, so a mismatch is visible at a
                  // glance. Net Hrs/OT/Dept/Shift drop out here — they don't help for this
                  // specific check the way they do for the default view.
                  <>
                    <thead><tr className="border-b border-white/10">
                      {['Employee', 'Emp Code', 'Manager', 'In', 'Out', 'Note (typed)', 'Location (GPS)', 'GPS Trail (2-hrly)', 'Status'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}
                    </tr></thead>
                    <tbody>{shownEmps.map(e => {
                      const r = attendance[`${e.id}_${today}`] || {}
                      const trail = gpsTrails[e.id] || []
                      return (
                        <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-2.5 pr-4 font-medium text-white/80">{e.name}</td>
                          <td className="py-2.5 pr-4 text-white/30">{e.empNum || '--'}</td>
                          <td className="py-2.5 pr-4 text-white/30">{e.manager || '--'}</td>
                          <td className="py-2.5 pr-4 font-mono text-emerald-400">{r.inTime || '--'}</td>
                          <td className="py-2.5 pr-4 font-mono text-red-400">{r.outTime || '--'}</td>
                          <td className="py-2.5 pr-4 max-w-[180px] truncate italic text-white/50">{r.fieldNote || '--'}</td>
                          <td className="py-2.5 pr-4 max-w-[220px] truncate text-purple-400/80">{r.inLocation || r.outLocation || '--'}</td>
                          <td className="py-2.5 pr-4">
                            {trail.length > 0 ? (
                              <button className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2" onClick={() => setTrailEmp(e)}>
                                {trail.length} ping{trail.length !== 1 ? 's' : ''} · last {new Date(trail[trail.length - 1].capturedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                              </button>
                            ) : (
                              <span className="text-white/30">--</span>
                            )}
                          </td>
                          <td className="py-2.5"><Badge status={r.status || 'Absent'} /></td>
                        </tr>
                      )
                    })}</tbody>
                  </>
                ) : (
                  <>
                    <thead><tr className="border-b border-white/10">
                      {['Employee', 'Emp Code', 'Dept', 'Shift', 'Manager', 'In', 'Out', 'Net Hrs', 'OT', 'Status'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}
                    </tr></thead>
                    <tbody>{shownEmps.map(e => {
                      const r = attendance[`${e.id}_${today}`] || {}
                      const net = Math.max(0, calcRawHrs(r.inTime, r.outTime))
                      const ot = calcOvertimeHours(r, stdHours)
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
                          <td className="py-2.5 pr-4 text-indigo-300">{ot > 0 ? fmtHrs(ot) : '--'}</td>
                          <td className="py-2.5"><Badge status={r.status || 'Absent'} /></td>
                        </tr>
                      )
                    })}</tbody>
                  </>
                )}
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={!!trailEmp} onClose={() => setTrailEmp(null)} title={trailEmp ? `${trailEmp.name} — GPS Trail (${today})` : ''}>
        <div className="space-y-2">
          {(gpsTrails[trailEmp?.id] || []).map(p => (
            <div key={p.id} className="flex items-start justify-between gap-3 text-xs border-b border-white/5 pb-2">
              <span className="font-mono text-cyan-400 whitespace-nowrap">{new Date(p.capturedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-white/70 text-right">{p.latLon || '--'}</span>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
