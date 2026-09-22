import { TravelPhotoThumb } from './TravelPhotoThumb'
import { haversineMeters } from '../lib/geo'
import { effectiveLegKm, effectiveReturnLegKm } from '../lib/travelPoints'

// plan.md §28 follow-up (2026-09-22) — a small, quiet label so it's never ambiguous
// which kind of number someone's looking at: a real road distance once refined, the
// original instant estimate before that, or something admin corrected by hand.
function SourceBadge({ source }) {
  if (source === 'adjusted') return <span className="text-amber-400/70">adjusted</span>
  if (source === 'routed') return <span className="text-emerald-400/60">road distance</span>
  return <span className="text-white/25">~ estimate</span>
}

// Shared by employee/manager/admin Travel screens (plan.md §28 follow-up, 2026-09-22 —
// admin feedback after Puneet Sharma's first real use: the map already draws punch-in
// -> visits -> punch-out as one connected line, but the on-screen list only showed the
// visits, not the punch-in/punch-out bookends the line implies). Renders one day's full
// chain: Punch In -> visit 1 -> visit 2 -> ... -> Punch Out -> day total, consistently
// in one place instead of three near-identical copies.
export function TravelDayChain({ visits, attendanceRecord, fetchPhotoUrl, onOpenPhoto, selectedVisitId, onSelectVisit, renderVisitExtra }) {
  const lastVisit = visits[visits.length - 1]
  const returnFallbackKm = (lastVisit && attendanceRecord?.outLat != null)
    ? haversineMeters(lastVisit.lat, lastVisit.lon, attendanceRecord.outLat, attendanceRecord.outLon) / 1000
    : 0
  const returnLeg = effectiveReturnLegKm(attendanceRecord, returnFallbackKm)
  const dayKm = visits.reduce((s, v) => s + effectiveLegKm(v).km, 0) + (attendanceRecord?.outTime ? returnLeg.km : 0)

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

      {visits.map(v => {
        const leg = effectiveLegKm(v)
        return (
          <div
            key={v.id}
            className={`flex items-center gap-3 p-2 rounded-xl border ${selectedVisitId === v.id ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}
            onClick={() => onSelectVisit?.(v.id)}
          >
            <TravelPhotoThumb path={v.photoPath} fetchUrl={fetchPhotoUrl} onOpen={onOpenPhoto} className="w-12 h-12" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{v.siteNote}</p>
              <p className="text-white/30 text-xs">
                {new Date(v.capturedAt).toLocaleTimeString()} · {leg.km.toFixed(1)} km · <SourceBadge source={leg.source} />
                {leg.source === 'adjusted' && v.overrideReason ? `: ${v.overrideReason}` : ''}
              </p>
              {v.expenseAmount != null && (
                <p className="text-amber-300/80 text-xs mt-0.5">{v.expenseNote || 'Expense'} · ₹{v.expenseAmount.toFixed(2)}</p>
              )}
            </div>
            {v.expensePhotoPath && <TravelPhotoThumb path={v.expensePhotoPath} fetchUrl={fetchPhotoUrl} onOpen={onOpenPhoto} className="w-10 h-10" />}
            {renderVisitExtra?.(v)}
          </div>
        )
      })}

      {attendanceRecord?.outTime ? (
        <div className="flex items-center gap-3 p-2 rounded-xl border border-red-500/20 bg-red-500/5">
          <span className="w-12 h-12 rounded-lg bg-red-500/20 flex items-center justify-center text-red-300 text-xs font-bold shrink-0">OUT</span>
          <div className="flex-1 min-w-0">
            <p className="text-red-300 text-sm font-medium truncate">{attendanceRecord.outLocation || 'Punch Out'}</p>
            <p className="text-white/30 text-xs">{attendanceRecord.outTime} · {returnLeg.km.toFixed(1)} km · <SourceBadge source={returnLeg.source} /></p>
          </div>
        </div>
      ) : (
        <p className="text-white/20 text-xs px-2">Not punched out yet — distance back to base not counted until then</p>
      )}

      <p className="text-white/40 text-xs px-2 pt-1">Day total: <span className="text-white/70 font-medium">{dayKm.toFixed(1)} km</span></p>
    </div>
  )
}
