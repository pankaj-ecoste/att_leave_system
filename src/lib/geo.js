// Distance/geofence math. Only haversineMeters is used on Day 1 (none yet, actually —
// the punch screen still stores a text location label until the Day 2 `sites` migration
// lands, plan.md Phase 3). Laid down now because it's a pure, self-contained function
// with no dependency on the sites table, so there's no reason to wait.

const EARTH_RADIUS_M = 6371000

// Great-circle distance between two lat/lon points, in metres.
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}
