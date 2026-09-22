// Distance/geofence math. The server (employee_punch, supabase/migrations/
// 0007_geofence_and_wfh.sql's haversine_m — same formula, kept in sync by hand) is the
// one that actually decides accept/reject (plan.md §6B — "the server decides, not the
// phone") and the one that actually computes any stored/paid travel distance
// (employee_add_travel_visit always calls haversine_m itself, never trusts a
// client-submitted number — verified 2026-09-22, plan.md §33.6). Everything here is
// display-only: the punch screen highlighting the nearest office tile, and the travel
// screens' live "km so far" estimate before the server's own number is available.
//
// Two hand-kept copies of one formula (one JS, one SQL) is still a drift risk even
// though neither side is money-critical today — geo.test.js pins this function's
// output against an independent transliteration of haversine_m, so an edit that makes
// the two disagree fails a test instead of silently showing a wrong estimate.

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

// Nearest active site to a point, for highlighting a tile before the employee taps it
// (plan.md §6B — "highlights the nearest one"). Returns null if there's no fix yet or
// no active sites; the server independently recomputes this at punch time regardless.
export function nearestSite(lat, lon, sites) {
  if (lat == null || lon == null) return null
  let best = null
  for (const s of sites) {
    if (!s.active) continue
    const distance = haversineMeters(lat, lon, s.latitude, s.longitude)
    if (!best || distance < best.distance) best = { site: s, distance }
  }
  return best
}
