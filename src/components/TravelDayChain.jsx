import { TravelPhotoThumb } from './TravelPhotoThumb'
import { haversineMeters } from '../lib/geo'

// Shared by employee/manager/admin Travel screens (plan.md §28 follow-up, 2026-09-22 —
// admin feedback after Puneet Sharma's first real use: the map already draws punch-in
// -> visits -> punch-out as one connected line, but the on-screen list only showed the
// visits, not the punch-in/punch-out bookends the line implies). Renders one day's full
// chain: Punch In -> visit 1 -> visit 2 -> ... -> Punch Out -> day total, consistently
// in one place instead of three near-identical copies.
export function TravelDayChain({ visits, attendanceRecord, onOpenPhoto, selectedVisitId, onSelectVisit, renderVisitExtra }) {
  // Matches travel_summary_for_employee's server-side total: the stored legs plus the
  // implicit last-visit -> punch-out leg, which is never stored as its own row (it's
  // computed fresh every time so it updates the moment they punch out). This is a
  // display-only mirror of that math — the server total is what's actually paid out.
  const storedKm = visits.reduce((s, v) => s + v.legDistanceKm, 0)
  const lastVisit = visits[visits.length - 1]
  const returnLegKm = (lastVisit && attendanceRecord?.outLat != null)
    ? haversineMeters(lastVisit.lat, lastVisit.lon, attendanceRecord.outLat, attendanceRecord.outLon) / 1000
    : 0
  const dayKm = storedKm + returnLegKm

  return (
    <div className="space-y-1.5">
      {attendanceRecord?.inTime && (
        <div className="flex items-center gap-3 p-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
          <span className="w-12 h-12 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-300 text-xs font-bold shrink-0">IN</span>
          <div className="flex-1 min-w-0">
            <p className="text-emerald-300 text-sm font-medium truncate">{attendanceRecord.inLocation || 'Punch In'}</p>
            <p className="text-white/30 text-xs">{attendanceRecord.inTime}</p>
          </div>
        </div>
      )}

      {visits.map(v => (
        <div
          key={v.id}
          className={`flex items-center gap-3 p-2 rounded-xl border ${selectedVisitId === v.id ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}
          onClick={() => onSelectVisit?.(v.id)}
        >
          <TravelPhotoThumb path={v.photoPath} onOpen={onOpenPhoto} className="w-12 h-12" />
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{v.siteNote}</p>
            <p className="text-white/30 text-xs">
              {new Date(v.capturedAt).toLocaleTimeString()} · {v.legDistanceKm.toFixed(1)} km{v.distanceOverridden ? ` (adjusted${v.overrideReason ? `: ${v.overrideReason}` : ''})` : ''}
            </p>
            {v.expenseAmount != null && (
              <p className="text-amber-300/80 text-xs mt-0.5">{v.expenseNote || 'Expense'} · ₹{v.expenseAmount.toFixed(2)}</p>
            )}
          </div>
          {v.expensePhotoPath && <TravelPhotoThumb path={v.expensePhotoPath} onOpen={onOpenPhoto} className="w-10 h-10" />}
          {renderVisitExtra?.(v)}
        </div>
      ))}

      {attendanceRecord?.outTime ? (
        <div className="flex items-center gap-3 p-2 rounded-xl border border-red-500/20 bg-red-500/5">
          <span className="w-12 h-12 rounded-lg bg-red-500/20 flex items-center justify-center text-red-300 text-xs font-bold shrink-0">OUT</span>
          <div className="flex-1 min-w-0">
            <p className="text-red-300 text-sm font-medium truncate">{attendanceRecord.outLocation || 'Punch Out'}</p>
            <p className="text-white/30 text-xs">{attendanceRecord.outTime}</p>
          </div>
        </div>
      ) : (
        <p className="text-white/20 text-xs px-2">Not punched out yet — distance back to base not counted until then</p>
      )}

      <p className="text-white/40 text-xs px-2 pt-1">Day total: <span className="text-white/70 font-medium">{dayKm.toFixed(1)} km</span></p>
    </div>
  )
}
