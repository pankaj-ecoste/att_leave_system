#!/usr/bin/env node
// Read-only diagnostic — investigates ONE reported "HRMS distance doesn't match what I
// see on Google" case. Finds every day whose punch-in location text matches a search
// string, and for each visit that day prints the GPS coordinates, what those coordinates
// reverse-geocode to (i.e. where GPS actually put the person, vs what they typed), and
// the leg distance three ways: stored, straight-line, and a fresh Google Routes call.
// Optionally also asks Google Routes for the distance between two ADDRESS STRINGS (as a
// person would type into Google), so "address vs address" and "our GPS points" can be
// compared directly. Writes nothing.
//
// Usage: DATABASE_URL="..." node scripts/diagnostics/inspect-travel-legs-by-punch-in-address.mjs "Rattan Park" ["origin address" "destination address"]

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
const search = process.argv[2]
if (!connectionString || !search) {
  console.error('Usage: DATABASE_URL=... node scripts/diagnostics/inspect-travel-legs-by-punch-in-address.mjs "<punch-in address text>" ["origin address" "destination address"]')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371, rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
const googleKm = async (a, b, c, d) => (await client.query(
  `select road_distance_km_google(google_maps_api_key, $1::numeric, $2::numeric, $3::numeric, $4::numeric) as km from travel_routing_settings where id = 1`,
  [a, b, c, d])).rows[0].km
const addr = async (lat, lon) => (await client.query(`select reverse_geocode($1::numeric, $2::numeric) as a`, [lat, lon])).rows[0].a

const { rows: days } = await client.query(`
  select e.name, a.emp_id, to_char(a.date, 'YYYY-MM-DD') as day, a.in_lat, a.in_lon, a.in_location, a.out_lat, a.out_lon, a.out_location, a.travel_return_road_km
  from attendance a join employees e on e.id = a.emp_id
  where a.in_location ilike $1 and exists (select 1 from travel_visits v where v.emp_id = a.emp_id and v.date = a.date)
  order by a.date
`, [`%${search}%`])

if (!days.length) console.log(`No day with open travel visits has a punch-in location matching "${search}".`)

for (const d of days) {
  console.log(`\n=== ${d.name} — ${d.day} ===`)
  console.log(`Punch in : (${d.in_lat}, ${d.in_lon})  "${d.in_location}"`)
  let prev = { lat: d.in_lat, lon: d.in_lon }
  const { rows: visits } = await client.query(
    `select site_note, lat, lon, leg_distance_km, road_leg_km, distance_overridden, accuracy_m
     from travel_visits where emp_id = $1 and date = $2::date order by captured_at`, [d.emp_id, d.day])
  for (const v of visits) {
    const straight = haversineKm(prev.lat, prev.lon, v.lat, v.lon)
    const g = await googleKm(prev.lat, prev.lon, v.lat, v.lon)
    console.log(`\nVisit "${v.site_note}"  GPS (${v.lat}, ${v.lon})  accuracy ${v.accuracy_m == null ? '?' : Number(v.accuracy_m).toFixed(0) + 'm'}`)
    console.log(`  GPS reverse-geocodes to: ${await addr(v.lat, v.lon)}`)
    console.log(`  leg: stored ${Number(v.distance_overridden ? v.leg_distance_km : (v.road_leg_km ?? v.leg_distance_km)).toFixed(2)} km${v.distance_overridden ? ' (adjusted)' : ''} | straight-line ${straight.toFixed(2)} km | Google now ${g == null ? 'n/a' : Number(g).toFixed(2)} km`)
    prev = { lat: v.lat, lon: v.lon }
  }
  if (d.out_lat != null && visits.length) {
    const straight = haversineKm(prev.lat, prev.lon, d.out_lat, d.out_lon)
    const g = await googleKm(prev.lat, prev.lon, d.out_lat, d.out_lon)
    console.log(`\nPunch out: (${d.out_lat}, ${d.out_lon})  "${d.out_location}"`)
    console.log(`  return leg: stored ${d.travel_return_road_km ?? 'n/a'} km | straight-line ${straight.toFixed(2)} km | Google now ${g == null ? 'n/a' : Number(g).toFixed(2)} km`)
  }
}

if (process.argv[3] && process.argv[4]) {
  const body = JSON.stringify({ origin: { address: process.argv[3] }, destination: { address: process.argv[4] }, travelMode: 'DRIVE' })
  const { rows } = await client.query(`
    select r.status, left(r.content, 400) as body
    from (select google_maps_api_key as k from travel_routing_settings where id = 1) k,
    lateral (select * from extensions.http(('POST', 'https://routes.googleapis.com/directions/v2:computeRoutes',
      array[extensions.http_header('X-Goog-Api-Key', k.k), extensions.http_header('X-Goog-FieldMask', 'routes.distanceMeters')],
      'application/json', $1)::extensions.http_request)) r
  `, [body])
  console.log(`\n--- Google Routes, address text to address text ---\n"${process.argv[3]}"\n -> "${process.argv[4]}"`)
  console.log(rows[0].status, rows[0].body.replace(/\s+/g, ' '))
}

await client.end()
