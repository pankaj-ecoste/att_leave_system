import { supabase } from '../lib/supabase'
import { ACCEPTABLE_GPS_ACCURACY_M, GPS_RETRY_ATTEMPTS } from '../lib/constants'

// Reverse geocoding now runs server-side, cached (P3-9) — supabase/migrations/
// 0005_field_staff_and_geo.sql's reverse_geocode() RPC, not a direct browser call to
// Nominatim on every punch (plan.md §4.4 #8: that's against their usage policy and
// leaks staff locations to a third party on every request).
async function reverseGeocode(lat, lon) {
  try {
    const { data, error } = await supabase.rpc('reverse_geocode', { p_lat: lat, p_lon: lon })
    if (error) throw error
    return data || null
  } catch (e) {
    console.error('Reverse geocoding failed:', e)
    return null
  }
}

function getPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

// Requests a fresh, high-accuracy GPS fix, retrying up to GPS_RETRY_ATTEMPTS times and
// keeping the best (lowest accuracy-value) reading seen so far — stops early once a
// reading meets ACCEPTABLE_GPS_ACCURACY_M (P3-7). A weak signal (indoors, cloudy) can
// still mean every attempt comes back poor; this never blocks on that, it just makes
// sure a bad *first* reading isn't the only one tried.
async function getBestPosition() {
  let best = null
  for (let attempt = 0; attempt < GPS_RETRY_ATTEMPTS; attempt++) {
    try {
      const pos = await getPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
      if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos
      if (pos.coords.accuracy <= ACCEPTABLE_GPS_ACCURACY_M) break
    } catch (err) {
      if (!best) throw err // no reading at all yet — surface the real browser error
      break // already have something usable; don't fail on a later timeout/denial
    }
  }
  return best
}

// cb(locationLabel, errorMessage, meta). `meta` is { lat, lon, accuracy } from the best
// reading obtained — not persisted anywhere yet (real coordinate storage lands with the
// `sites` table, P3-2); it's here purely so the caller can show reading quality today.
export function getLocation(cb) {
  if (!navigator.geolocation) {
    cb(null, 'Geolocation not supported', null)
    return
  }
  ;(async () => {
    try {
      const pos = await getBestPosition()
      const { latitude: lat, longitude: lon, accuracy } = pos.coords
      const placeName = await reverseGeocode(lat, lon)
      const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`
      cb(placeName || fallback, null, { lat, lon, accuracy })
    } catch (err) {
      const msgs = { 1: 'Permission denied by browser', 2: 'Position unavailable', 3: 'Timed out' }
      cb(null, msgs[err?.code] || 'Location unavailable', null)
    }
  })()
}
