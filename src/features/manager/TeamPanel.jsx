import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { MONTHS, getShiftInfo } from '../../lib/constants'
import { calcRawHrs, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'

// The manager view for anyone with direct reports — appears as a tab inside the
// employee dashboard (one person can be both), not a separate login.
export function TeamPanel({
  token, myTeam, teamLeaves, teamRegs, teamAttn, teamLoading, loadTeamAttendance, decideLeave, decideRegularization,
  teamLocationLogs, teamLocationLoading, loadTeamLocationLogs,
}) {
  const [tab, setTab] = useState('requests')
  const [monthSel, setMonthSel] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() })
  const [locDate, setLocDate] = useState(todayIST())

  function selectTab(t) {
    setTab(t)
    if (t === 'attendance') loadTeamAttendance(monthSel.month, monthSel.year)
    // P3-15 — the manager's own team's location log, scoped server-side to direct
    // reports only (manager_get_team_location_logs).
    if (t === 'location') loadTeamLocationLogs(locDate)
  }

  async function handleDecide(fn, id, status) {
    try {
      await fn(id, status)
    } catch (err) {
      alert(err.message)
    }
  }

  const pendingLeaves = teamLeaves.filter(l => l.status === 'Pending')
  const pendingRegs = teamRegs.filter(r => r.status === 'Pending')
  // P4-3 — a manager's "Approved" isn't final anymore (P4-1, two-stage approval): it
  // moves to 'Manager Approved' and waits on admin. Shown separately, read-only, so the
  // manager can see it's out of their hands without it looking like a final outcome.
  const awaitingAdmin = teamLeaves.filter(l => l.status === 'Manager Approved')
  const actioned = [
    ...teamLeaves.filter(l => l.status === 'Approved' || l.status === 'Rejected'),
    ...teamRegs.filter(r => r.status !== 'Pending'),
  ].slice(0, 10)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-white font-semibold">My Team <span className="text-white/30 text-sm font-normal">({myTeam.length} direct reports)</span></h2>
          {teamLoading && <span className="text-white/30 text-xs">Loading...</span>}
        </div>
        <div className="flex gap-2 mb-4 flex-wrap">
          {[['requests', 'Requests'], ['attendance', 'Attendance'], ['location', 'Location'], ['members', 'Members']].map(([t, l]) => (
            <button key={t} onClick={() => selectTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${tab === t ? 'bg-indigo-600/30 border-indigo-500/40 text-white' : 'bg-white/5 border-white/10 text-white/50'}`}>{l}</button>
          ))}
        </div>

        {tab === 'requests' && (
          <>
            <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Leave Requests</p>
            {pendingLeaves.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-4">No pending leave requests</p>
            ) : pendingLeaves.map(l => (
              <div key={l.id} className="bg-white/5 border border-white/10 rounded-xl p-3 mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white font-medium text-sm">{l.empName}</p>
                    <p className="text-white/50 text-xs">{l.leaveType} · {l.date}</p>
                    <p className="text-white/30 text-xs mt-1 italic">{l.reason}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button className="text-xs py-1 px-3" onClick={() => handleDecide(decideLeave, l.id, 'Approved')}>Approve</Button>
                    <Button variant="danger" onClick={() => handleDecide(decideLeave, l.id, 'Rejected')}>Reject</Button>
                  </div>
                </div>
              </div>
            ))}
            {awaitingAdmin.length > 0 && (
              <>
                <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2 mt-4">Approved by You · Awaiting Admin</p>
                {awaitingAdmin.map(l => (
                  <div key={l.id} className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3 mb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-white font-medium text-sm">{l.empName}</p>
                        <p className="text-white/50 text-xs">{l.leaveType} · {l.date}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 shrink-0">Sent to Admin</span>
                    </div>
                  </div>
                ))}
              </>
            )}
            <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2 mt-4">Correction Requests</p>
            {pendingRegs.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-4">No pending correction requests</p>
            ) : pendingRegs.map(r => (
              <div key={r.id} className="bg-white/5 border border-white/10 rounded-xl p-3 mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white font-medium text-sm">{r.empName}</p>
                    <p className="text-white/50 text-xs">{r.date} · <span className="font-mono">{r.requestedIn || '--:--'} — {r.requestedOut || '--:--'}</span></p>
                    <p className="text-white/30 text-xs mt-1 italic">{r.reason}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button className="text-xs py-1 px-3" onClick={() => handleDecide(decideRegularization, r.id, 'Approved')}>Approve</Button>
                    <Button variant="danger" onClick={() => handleDecide(decideRegularization, r.id, 'Rejected')}>Reject</Button>
                  </div>
                </div>
              </div>
            ))}
            {actioned.length > 0 && (
              <>
                <p className="text-white/20 text-xs font-medium uppercase tracking-wide mb-2 mt-4">Previously Actioned</p>
                {actioned.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/5">
                    <div>
                      <p className="text-white/50 text-xs font-medium">{item.empName} · {item.leaveType || `Correction ${item.date}`}</p>
                      <p className="text-white/20 text-xs">{item.date}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${item.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>{item.status}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {tab === 'attendance' && (
          <>
            <div className="flex gap-2 mb-4 flex-wrap">
              <select className="bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-white text-xs" value={monthSel.month} onChange={e => { const s = { ...monthSel, month: +e.target.value }; setMonthSel(s); loadTeamAttendance(s.month, s.year) }}>
                {MONTHS.map((mn, i) => <option key={i + 1} value={i + 1}>{mn}</option>)}
              </select>
              <select className="bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-white text-xs" value={monthSel.year} onChange={e => { const s = { ...monthSel, year: +e.target.value }; setMonthSel(s); loadTeamAttendance(s.month, s.year) }}>
                {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i).map(yr => <option key={yr} value={yr}>{yr}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead><tr className="border-b border-white/10">
                  {['Employee', 'Present', 'Absent', 'Leave', 'Half Day', 'Hours'].map(h => <th key={h} className="text-left py-2 pr-4 text-white/30 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>{myTeam.map(emp => {
                  const recs = Object.entries(teamAttn).filter(([k]) => k.startsWith(`${emp.id}_`)).map(([, v]) => v)
                  const present = recs.filter(r => r.status === 'Present').length
                  const absent = recs.filter(r => r.status === 'Absent').length
                  const leave = recs.filter(r => ['Leave', 'WFH', 'On Duty'].includes(r.status)).length
                  const half = recs.filter(r => r.status === 'Half Day').length
                  const hrs = recs.reduce((s, r) => s + calcRawHrs(r.inTime, r.outTime), 0)
                  return (
                    <tr key={emp.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 pr-4 font-medium text-white/80">{emp.name}</td>
                      <td className="py-2 pr-4 text-emerald-400">{present}</td>
                      <td className="py-2 pr-4 text-red-400">{absent}</td>
                      <td className="py-2 pr-4 text-amber-400">{leave}</td>
                      <td className="py-2 pr-4 text-yellow-400">{half}</td>
                      <td className="py-2 pr-4">{fmtHrs(hrs)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'location' && (
          <>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-white/40 text-xs">Date:</span>
              <Input type="date" className="w-auto text-xs" value={locDate} max={todayIST()} onChange={e => { setLocDate(e.target.value); loadTeamLocationLogs(e.target.value) }} />
              {teamLocationLoading && <span className="text-white/30 text-xs">Loading...</span>}
            </div>
            {teamLocationLogs.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-8">{teamLocationLoading ? 'Loading...' : 'No location pings for this date'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-white/60 min-w-max">
                  <thead><tr className="border-b border-white/10">{['Time', 'Employee', 'Location', 'Type'].map(h => <th key={h} className="text-left py-2 pr-4 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody>{teamLocationLogs.map(r => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 pr-4 whitespace-nowrap font-mono">{new Date(r.capturedAt).toLocaleTimeString()}</td>
                      <td className="py-2 pr-4 whitespace-nowrap font-medium text-white/80">{r.empName}</td>
                      <td className="py-2 pr-4 max-w-[250px] truncate text-purple-400/80">{r.latLon}</td>
                      <td className="py-2 pr-4 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.type === 'punch_in' ? 'bg-emerald-500/20 text-emerald-300' : r.type === 'punch_out' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'}`}>{r.type === 'punch_in' ? 'Punch In' : r.type === 'punch_out' ? 'Punch Out' : 'Auto'}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'members' && (
          <div className="space-y-2">
            {myTeam.map(emp => (
              <div key={emp.id} className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center font-bold text-white text-sm shrink-0">
                  {emp.name[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{emp.name}</p>
                  <p className="text-white/30 text-xs">{emp.empNum ? `#${emp.empNum} · ` : ''}{emp.jobTitle || emp.dept || '—'}</p>
                </div>
                <div className="ml-auto">
                  {(() => { const sh = getShiftInfo(null, emp); return sh.id !== 'none' && <span className="text-xs font-semibold px-2 py-0.5 rounded whitespace-nowrap" style={{ background: sh.color + '33', color: sh.color, border: `1px solid ${sh.color}55` }}>{sh.label}</span> })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
