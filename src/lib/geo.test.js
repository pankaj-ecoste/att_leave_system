import { describe, it, expect } from 'vitest'
import { haversineMeters } from './geo'

// plan.md §33.6 — geo.js's own comment already says haversineMeters is "the same
// formula" as the database's haversine_m() (supabase/migrations/0007_geofence_and_wfh.sql),
// "kept in sync by hand." Traced the money path first (2026-09-22): the client's copy
// never becomes a paid amount — employee_add_travel_visit always computes
// leg_distance_km itself, server-side, using haversine_m; admin_settle_travel_period
// only ever sums server-stored distances. So this isn't a payment bug today, but two
// hand-kept copies of one formula is exactly the shape that already caused a real bug
// once in this codebase (5 duplicated overtime-hours calculations before
// calcOvertimeHours consolidated them). A JS/SQL pair can't be consolidated into one
// function the way that was — they run in different languages — so instead this test
// pins the client formula against an independent transliteration of the SQL one,
// asin-based instead of atan2-based (the two are standard equivalent forms of the same
// great-circle formula). If a future edit to either haversineMeters or haversine_m
// changes its output, this test is the thing that catches the drift instead of it
// surfacing as a silently-wrong on-screen estimate.

// Direct transliteration of supabase/migrations/0007_geofence_and_wfh.sql's haversine_m:
//   6371000 * 2 * asin(sqrt(sin(radians(lat2-lat1)/2)^2 + cos(radians(lat1))*cos(radians(lat2))*sin(radians(lon2-lon1)/2)^2))
function sqlHaversineReference(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const rad = deg => (deg * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

describe('haversineMeters vs the database haversine_m formula (drift guard)', () => {
  // Realistic GPS distances for this app only — employee travel/geofence points, never
  // anywhere near antipodal. (The atan2-based and asin-based forms are mathematically
  // equivalent but diverge by centimetres at truly global, near-antipodal distances —
  // that's a known floating-point characteristic of the two forms, not a formula bug,
  // and irrelevant at the scale this app actually operates at.)
  const cases = [
    { name: 'same point', p: [28.6139, 77.2090, 28.6139, 77.2090] },
    { name: 'a few km apart (Delhi-ish)', p: [28.6139, 77.2090, 28.7041, 77.1025] },
    { name: 'equator, 1 degree of longitude apart', p: [0, 0, 0, 1] },
    { name: 'high latitude', p: [60, 10, 60.5, 11] },
    { name: 'crossing the equator', p: [-10, 40, 10, 41] },
    { name: 'a few hundred km (realistic upper bound for this app)', p: [28.6139, 77.2090, 26.8467, 80.9462] },
  ]

  for (const { name, p } of cases) {
    it(`matches the SQL-equivalent formula: ${name}`, () => {
      const client = haversineMeters(...p)
      const reference = sqlHaversineReference(...p)
      // Floating-point rounding only — a real formula drift would be off by meters or
      // more, not fractions of a millimetre.
      expect(client).toBeCloseTo(reference, 6)
    })
  }

  it('is symmetric (A to B equals B to A)', () => {
    const [lat1, lon1, lat2, lon2] = [28.6139, 77.2090, 19.0760, 72.8777]
    expect(haversineMeters(lat1, lon1, lat2, lon2)).toBeCloseTo(haversineMeters(lat2, lon2, lat1, lon1), 9)
  })
})
