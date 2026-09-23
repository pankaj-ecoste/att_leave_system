// plan.md §28 — shared by MyJourney.jsx / admin's Travel.jsx / manager's TeamPanel.jsx
// and by JourneyMap.jsx itself. Deliberately its own file with zero dependencies
// (not exported from JourneyMap.jsx): JourneyMap.jsx pulls in Leaflet at module scope
// and is only ever reached via a lazy import() so that library stays out of the main
// bundle — importing this helper FROM there would drag Leaflet along with it into
// every screen that just wants to build the point list, defeating that lazy-load.
//
// Punch-in/punch-out bookends plus every visit that day, in order — the same three
// screens showing the same chain the map draws as one connected line.
export function dayPoints(dateVisits, attendanceRecord) {
  const points = []
  if (attendanceRecord?.inLat != null) {
    points.push({
      id: 'start', lat: attendanceRecord.inLat, lon: attendanceRecord.inLon, kind: 'start',
      label: `Punch in ${attendanceRecord.inTime || ''}`,
      // Already reverse-geocoded and stored at punch time — no need to fetch it again
      // on the map (JourneyMap.jsx only live-fetches when address is missing).
      address: attendanceRecord.inLocation || null,
    })
  }
  dateVisits.forEach(v => points.push({ id: v.id, lat: v.lat, lon: v.lon, label: v.siteNote, kind: 'visit' }))
  if (attendanceRecord?.outLat != null) {
    points.push({
      id: 'end', lat: attendanceRecord.outLat, lon: attendanceRecord.outLon, kind: 'end',
      label: `Punch out ${attendanceRecord.outTime || ''}`,
      address: attendanceRecord.outLocation || null,
    })
  }
  return points
}

// plan.md §28 follow-up (2026-09-22) — which distance number to actually show for one
// visit's leg. A human override always wins (admin already looked at this one and
// corrected it); otherwise prefer the refined road distance once admin's review has
// computed it; the original instant straight-line estimate is always there as the
// fallback until then. `source` drives a small badge so it's never ambiguous which
// kind of number someone's looking at.
export function effectiveLegKm(visit) {
  if (visit.distanceOverridden) return { km: visit.legDistanceKm, source: 'adjusted' }
  if (visit.roadLegKm != null) return { km: visit.roadLegKm, source: 'routed' }
  return { km: visit.legDistanceKm, source: 'estimated' }
}

// Same idea for the day's last-visit -> punch-out leg, which isn't its own row —
// `clientFallbackKm` is the haversine distance the caller already computed for display
// before a refine has ever run (mirrors the server's own fallback in
// travel_summary_for_employee so the two never disagree).
export function effectiveReturnLegKm(attendanceRecord, clientFallbackKm) {
  if (attendanceRecord?.travelReturnRoadKm != null) return { km: attendanceRecord.travelReturnRoadKm, source: 'routed' }
  return { km: clientFallbackKm, source: 'estimated' }
}
