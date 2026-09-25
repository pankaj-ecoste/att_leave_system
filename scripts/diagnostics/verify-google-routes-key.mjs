#!/usr/bin/env node
// Read-only diagnostic — confirms the Google Maps API key admin saved actually works
// against the real Routes API, using Puneet Sharma's known punch-in -> Supernova leg as
// a live test (ORS measured it at 16.743km; the same trip was ~15km by hand on Google
// Maps). road_distance_km_google() swallows every failure into a silent NULL by design
// (never breaks the app), so this also makes the raw call directly to show the real HTTP
// status/body when it doesn't work. The key itself is never printed — redacted in SQL.
//
// Usage: DATABASE_URL="..." node scripts/diagnostics/verify-google-routes-key.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL first.')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: status } = await client.query(`
  select google_maps_api_key is not null and btrim(google_maps_api_key) <> '' as google_set,
         ors_api_key is not null and btrim(ors_api_key) <> '' as ors_set
  from travel_routing_settings where id = 1
`)
console.log('Keys saved:', status[0])

if (!status[0].google_set) {
  console.log('No Google key saved yet — nothing to test.')
  await client.end()
  process.exit(0)
}

console.log('\n--- Raw call to Google Routes API (real status/body, key redacted) ---')
const { rows: raw } = await client.query(`
  select r.status, replace(left(r.content, 1200), k.key, '[REDACTED]') as body
  from (select google_maps_api_key as key from travel_routing_settings where id = 1) k,
  lateral (
    select * from extensions.http((
      'POST',
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      array[
        extensions.http_header('X-Goog-Api-Key', k.key),
        extensions.http_header('X-Goog-FieldMask', 'routes.distanceMeters')
      ],
      'application/json',
      '{"origin":{"location":{"latLng":{"latitude":28.638972,"longitude":77.364963}}},"destination":{"location":{"latLng":{"latitude":28.551055,"longitude":77.321045}}},"travelMode":"DRIVE"}'
    )::extensions.http_request)
  ) r
`)
console.log(raw[0])

console.log('\n--- Through our own functions ---')
const { rows: viaHelper } = await client.query(`
  select road_distance_km_google(google_maps_api_key, 28.638972, 77.364963, 28.551055, 77.321045) as google_km,
         road_distance_km_ors(ors_api_key, 28.638972, 77.364963, 28.551055, 77.321045) as ors_km,
         road_distance_km(28.638972, 77.364963, 28.551055, 77.321045) as dispatcher_km
  from travel_routing_settings where id = 1
`)
console.log(viaHelper[0], '(google_km should be a number; dispatcher_km should equal google_km once Google works)')

await client.end()
