// Wraps the browser Geolocation API + reverse geocoding into the callback shape the
// rest of the app expects: cb(locationLabel, errorMessage). Real coordinate storage +
// server-side geofencing lands with the `sites` table in Day 2 (plan.md §4.4) — until
// then this still resolves to a human-readable place name, same as the old app.

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`)
    if (!res.ok) throw new Error('Geocoding request failed')
    const data = await res.json()
    return data?.display_name || null
  } catch (e) {
    console.error('Reverse geocoding failed:', e)
    return null
  }
}

export function getLocation(cb) {
  if (!navigator.geolocation) {
    cb(null, 'Geolocation not supported')
    return
  }
  const ok = async pos => {
    const { latitude: lat, longitude: lon } = pos.coords
    const placeName = await reverseGeocode(lat, lon)
    const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`
    cb(placeName || fallback, null)
  }
  const fail = err => {
    const msgs = { 1: 'Permission denied by browser', 2: 'Position unavailable', 3: 'Timed out' }
    cb(null, msgs[err?.code] || 'Location unavailable')
  }
  navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 })
}
