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
    points.push({ id: 'start', lat: attendanceRecord.inLat, lon: attendanceRecord.inLon, label: `Punch in ${attendanceRecord.inTime || ''}`, kind: 'start' })
  }
  dateVisits.forEach(v => points.push({ id: v.id, lat: v.lat, lon: v.lon, label: v.siteNote, kind: 'visit' }))
  if (attendanceRecord?.outLat != null) {
    points.push({ id: 'end', lat: attendanceRecord.outLat, lon: attendanceRecord.outLon, label: `Punch out ${attendanceRecord.outTime || ''}`, kind: 'end' })
  }
  return points
}
