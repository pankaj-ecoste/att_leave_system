import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { getShiftInfo, requiresFieldNote } from '../../lib/constants'
import { calcRawHrs, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'

export function PunchPanel({ currentUser, record, stdHours, holidays, punch, isPunching, locationStatus, locationBlocked, odTrackingActive, odTrackLog }) {
  const [note, setNote] = useState('')
  // Field/Both employees don't get the office geofence check once it lands (they're
  // exempt from it, plan.md Decision 4) — a note ("where they are / where going")
  // stands in for it instead. Required before Punch In; free to update before Punch Out.
  const needsNote = requiresFieldNote(currentUser?.workMode)
  const noteMissing = needsNote && !note.trim()
  const raw = calcRawHrs(record.inTime, record.outTime)
  const net = Math.max(0, raw) // deduction for partial leave applied elsewhere; kept simple here since this is "today" only
  const ot = Math.max(0, net - stdHours)
  const shift = getShiftInfo(record, currentUser)
  const today = todayIST()
  const upcomingHolidays = holidays.filter(h => h.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 5)

  return (
    <>
      <Card>
        <h2 className="text-white font-semibold mb-4">Punch In / Out</h2>
        {needsNote && (
          <div className="mb-4">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1.5">
              Where are you? <span className="text-amber-400/70 normal-case">(required to punch in — you're on {currentUser.workMode === 'both' ? 'Office + Field' : 'Field'} mode)</span>
            </p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Client site — ABC Constructions, Nagpur"
              rows={2}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/10 transition-all placeholder-white/20 resize-none"
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => punch('in', note)}
            disabled={isPunching || noteMissing}
            title={noteMissing ? 'Enter a note before punching in' : undefined}
            className="bg-white/5 hover:bg-emerald-500/10 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-5 text-center transition-all active:scale-95 cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:border-white/10"
          >
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">IN TIME</p>
            <p className="text-white font-mono text-2xl font-bold mb-3">{record.inTime || '--:--'}</p>
            <p className="text-emerald-400 text-xs font-semibold group-hover:text-emerald-300">{isPunching ? 'Working…' : 'Punch In'}</p>
          </button>
          <button
            onClick={() => punch('out', note)}
            disabled={isPunching}
            className="bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/40 rounded-2xl p-5 text-center transition-all active:scale-95 cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:border-white/10"
          >
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">OUT TIME</p>
            <p className="text-white font-mono text-2xl font-bold mb-3">{record.outTime || '--:--'}</p>
            <p className="text-red-400 text-xs font-semibold group-hover:text-red-300">{isPunching ? 'Working…' : 'Punch Out'}</p>
          </button>
        </div>
        {locationStatus && (
          <div className={`rounded-lg p-2 mb-1 text-xs text-center ${locationStatus.startsWith('Located') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
            {locationStatus}
          </div>
        )}
        {locationBlocked && (
          <div className="rounded-lg p-3 mb-1 text-xs text-center bg-red-500/10 text-red-300 border border-red-500/20">
            <p className="font-semibold mb-1">Location access required</p>
            <p className="text-red-300/70">Please allow location access in your browser settings, then try again. Punching is not allowed without location.</p>
          </div>
        )}
        {/* The 2-hourly background tracking is deliberately silent — no indicator, no
            notice (plan.md Decision 5). A "tracking active" banner used to render
            here, directly contradicting that; removed rather than hidden, so a future
            edit can't accidentally bring it back. The interval itself still runs in
            useEmployeeAttendance.js — only the on-screen notice is gone. */}
        {(record.inLocation || record.outLocation) && (
          <p className="text-emerald-400/50 text-xs text-center mt-1 truncate">{record.inLocation || record.outLocation}</p>
        )}
        {odTrackingActive && (
          <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
            <p className="text-purple-300 text-xs font-medium mb-2">On Duty GPS Tracking Active</p>
            <div className="max-h-24 overflow-y-auto space-y-1">
              {odTrackLog.slice().reverse().map((entry, i) => (
                <p key={i} className="text-purple-400/70 text-xs font-mono">{entry.ts} — {entry.loc}</p>
              ))}
              {odTrackLog.length === 0 && <p className="text-purple-400/40 text-xs">Waiting for first location ping...</p>}
            </div>
          </div>
        )}
      </Card>
      <div className="grid grid-cols-3 gap-3">
        {[['Raw Hrs', fmtHrs(raw), 'white'], ['Net Hrs', fmtHrs(net), 'white'], ['Overtime', fmtHrs(ot), ot > 0 ? 'emerald' : '']].map(([k, v, c]) => (
          <div key={k} className="bg-white/5 rounded-2xl p-3 text-center border border-white/10">
            <p className="text-white/40 text-xs">{k}</p>
            <p className={`font-bold mt-1 ${c === 'emerald' ? 'text-emerald-400' : 'text-white'}`}>{v}</p>
          </div>
        ))}
      </div>
      {shift && shift.id !== 'none' && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Your Shift</p>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2 py-0.5 rounded whitespace-nowrap" style={{ background: shift.color + '33', color: shift.color, border: `1px solid ${shift.color}55` }}>
              {shift.label}
            </span>
            {shift.start && shift.end && <p className="text-white/60 text-sm font-mono">{shift.start} — {shift.end}</p>}
          </div>
        </div>
      )}
      {upcomingHolidays.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
          <p className="text-amber-300/80 text-xs font-semibold uppercase tracking-wide mb-3">Upcoming Holidays</p>
          <div className="space-y-2">
            {upcomingHolidays.map(h => (
              <div key={h.id} className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{h.name}</p>
                  <p className="text-white/30 text-xs">{h.date}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20">{h.type || 'Public'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
