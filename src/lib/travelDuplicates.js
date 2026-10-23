import { haversineMeters } from './geo'

// plan.md §52 — a visit that repeats an earlier one: the SAME site name (ignoring capitals and extra
// spaces), within 200 m, and saved within 10 minutes. This is the same rule the server uses to refuse
// a repeat (migration 0068); here it only decides which rows get a "Possible duplicate" mark, so a
// repeat that slipped in some other way is visible in the review instead of silently paid twice.
export const DUP_RADIUS_M = 200
export const DUP_WINDOW_MS = 10 * 60 * 1000

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

// Returns the Set of visit ids that repeat an earlier visit (the first of a group is NOT included).
export function suspectDuplicateIds(visits) {
  const ordered = [...(visits || [])].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))
  const flagged = new Set()
  ordered.forEach((v, i) => {
    for (let j = 0; j < i; j++) {
      const e = ordered[j]
      if (e.empId !== v.empId || e.date !== v.date) continue
      if (norm(e.siteNote) !== norm(v.siteNote)) continue
      if (new Date(v.capturedAt) - new Date(e.capturedAt) > DUP_WINDOW_MS) continue
      if (haversineMeters(e.lat, e.lon, v.lat, v.lon) > DUP_RADIUS_M) continue
      flagged.add(v.id)
      break
    }
  })
  return flagged
}
