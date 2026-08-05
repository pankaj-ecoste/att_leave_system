import { useState, useEffect } from 'react'
import { Card } from '../../components/ui/Card'
import { getShiftInfo, requiresFieldNote } from '../../lib/constants'
import { calcRawHrs, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'
import { haversineMeters, nearestSite } from '../../lib/geo'
import { getLocation } from '../../hooks/useGeolocation'

// Which action is next for today: nothing punched yet -> 'in', punched in but not out
// -> 'out', both done -> 'done'. Drives which tiles are tappable (plan.md §6B).
function phaseOf(record) {
  if (!record.inTime) return 'in'
  if (!record.outTime) return 'out'
  return 'done'
}

function PunchTile({ title, subtitle, phase, disabled, onClick, highlight, title2 }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center justify-between rounded-2xl p-4 text-left transition-all active:scale-[0.98] border disabled:opacity-40 disabled:cursor-not-allowed ${highlight ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-white/5 border-white/10 hover:border-white/20'}`}
    >
      <div>
        <p className="text-white font-medium text-sm">{title}{title2 && <span className="text-white/30 font-normal"> {title2}</span>}</p>
        <p className="text-white/40 text-xs mt-0.5">{subtitle}</p>
      </div>
      <span className={`text-xs font-semibold whitespace-nowrap ml-3 ${phase === 'in' ? 'text-emerald-400' : 'text-red-400'}`}>
        {phase === 'in' ? 'Punch In' : 'Punch Out'}
      </span>
    </button>
  )
}

export function PunchPanel({ currentUser, record, stdHours, holidays, sites, punch, isPunching, locationStatus, locationBlocked, odTrackingActive, odTrackLog }) {
  const [note, setNote] = useState('')
  // A soft, silent location fetch purely to highlight the nearest office tile and show
  // live distances before the employee taps anything (plan.md §6B — "highlights the
  // nearest one"). The actual punch always takes its own fresh, high-accuracy reading
  // via useEmployeeAttendance's punch() — this is display-only and never blocks a tap.
  const [liveCoords, setLiveCoords] = useState(null)

  const phase = phaseOf(record)
  const workMode = currentUser?.workMode || 'office'
  const showOfficeTiles = workMode === 'office' || workMode === 'both'
  const showFieldTile = workMode === 'field' || workMode === 'both'
  const showWfhTile = workMode === 'wfh'
  const activeSites = (sites || []).filter(s => s.active)

  useEffect(() => {
    if (phase === 'done' || !showOfficeTiles) return
    getLocation((loc, err, meta) => {
      if (meta) setLiveCoords({ lat: meta.lat, lon: meta.lon })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, showOfficeTiles])

  const nearest = liveCoords ? nearestSite(liveCoords.lat, liveCoords.lon, activeSites) : null

  // Field/Both employees don't get the office geofence check on the Field tile (they're
  // exempt, plan.md Decision 4) — a note ("where they are / where going") stands in for
  // it instead. Required before that tile is tappable.
  const needsNote = requiresFieldNote(workMode)
  const noteMissing = needsNote && !note.trim()

  const raw = calcRawHrs(record.inTime, record.outTime)
  const net = Math.max(0, raw) // deduction for partial leave applied elsewhere; kept simple here since this is "today" only
  const ot = Math.max(0, net - stdHours)
  const shift = getShiftInfo(record, currentUser)
  const today = todayIST()
  const upcomingHolidays = holidays.filter(h => h.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 5)

  const actionLabel = phase === 'in' ? 'Punch In' : phase === 'out' ? 'Punch Out' : null

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">{actionLabel || 'Today'}</h2>
          <div className="flex gap-4">
            <div className="text-right">
              <p className="text-white/30 text-xs uppercase tracking-widest">In</p>
              <p className="text-white font-mono text-sm">{record.inTime || '--:--'}</p>
            </div>
            <div className="text-right">
              <p className="text-white/30 text-xs uppercase tracking-widest">Out</p>
              <p className="text-white font-mono text-sm">{record.outTime || '--:--'}</p>
            </div>
          </div>
        </div>

        {needsNote && phase !== 'done' && (
          <div className="mb-4">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1.5">
              Where are you? <span className="text-amber-400/70 normal-case">(required for the Field tile)</span>
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

        {phase === 'done' ? (
          <div className="rounded-xl p-4 text-center bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-emerald-300 text-sm font-medium">Punched in and out for today</p>
          </div>
        ) : (
          <div className="space-y-2 mb-1">
            {showOfficeTiles && activeSites.length === 0 && (
              <p className="text-white/30 text-xs text-center py-2">No office sites configured yet — ask admin to add one in Sites.</p>
            )}
            {showOfficeTiles && activeSites.map(site => {
              const isNearest = nearest?.site.id === site.id
              const distance = liveCoords ? haversineMeters(liveCoords.lat, liveCoords.lon, site.latitude, site.longitude) : null
              return (
                <PunchTile
                  key={site.id}
                  title={site.name}
                  title2={isNearest ? '· Nearest' : ''}
                  subtitle={distance == null ? 'Locating…' : `${Math.round(distance)}m away · ${site.radiusM}m radius`}
                  phase={phase}
                  highlight={isNearest}
                  disabled={isPunching}
                  onClick={() => punch(phase, { siteId: site.id })}
                />
              )
            })}
            {showFieldTile && (
              <PunchTile
                title="Field"
                subtitle="No location check — note required"
                phase={phase}
                disabled={isPunching || noteMissing}
                onClick={() => punch(phase, { fieldNote: note })}
              />
            )}
            {showWfhTile && (
              <PunchTile
                title="Work From Home"
                subtitle="Your usual routine"
                phase={phase}
                disabled={isPunching}
                onClick={() => punch(phase, {})}
              />
            )}
          </div>
        )}

        {locationStatus && (
          <div className={`rounded-lg p-2 mb-1 mt-2 text-xs text-center ${locationStatus.startsWith('Located') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
            {locationStatus}
          </div>
        )}
        {locationBlocked && (
          <div className="rounded-lg p-3 mb-1 mt-2 text-xs text-center bg-red-500/10 text-red-300 border border-red-500/20">
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
