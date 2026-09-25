#!/usr/bin/env node
// Read-only diagnostic — asks Google Routes to route between two ADDRESS STRINGS and
// prints the coordinates Google resolved each one to (routes.legs.startLocation /
// endLocation), next to the distance. Used to answer "why does typing the address into
// Google give a different distance than our GPS points?" — an address text and a GPS fix
// can be many km apart (e.g. a place-name label covering a wide area), and this shows by
// how much. Writes nothing.
//
// Usage: DATABASE_URL="..." node scripts/diagnostics/where-does-google-put-these-addresses.mjs "<origin address>" "<destination address>"

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
const [origin, destination] = [process.argv[2], process.argv[3]]
if (!connectionString || !origin || !destination) {
  console.error('Usage: DATABASE_URL=... node scripts/diagnostics/where-does-google-put-these-addresses.mjs "<origin address>" "<destination address>"')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

const body = JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: 'DRIVE' })
const { rows } = await client.query(`
  select r.status, r.content
  from (select google_maps_api_key as k from travel_routing_settings where id = 1) k,
  lateral (select * from extensions.http(('POST', 'https://routes.googleapis.com/directions/v2:computeRoutes',
    array[extensions.http_header('X-Goog-Api-Key', k.k),
          extensions.http_header('X-Goog-FieldMask', 'routes.distanceMeters,routes.legs.startLocation,routes.legs.endLocation')],
    'application/json', $1)::extensions.http_request)) r
`, [body])

console.log('HTTP', rows[0].status)
const route = JSON.parse(rows[0].content)?.routes?.[0]
if (!route) { console.log(rows[0].content); process.exit(1) }
const leg = route.legs?.[0]
console.log(`Distance : ${(route.distanceMeters / 1000).toFixed(2)} km`)
console.log(`Origin      "${origin}"\n  resolved to ${leg?.startLocation?.latLng?.latitude}, ${leg?.startLocation?.latLng?.longitude}`)
console.log(`Destination "${destination}"\n  resolved to ${leg?.endLocation?.latLng?.latitude}, ${leg?.endLocation?.latLng?.longitude}`)

await client.end()
