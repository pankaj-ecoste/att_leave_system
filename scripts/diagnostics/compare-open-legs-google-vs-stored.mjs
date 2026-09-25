#!/usr/bin/env node
// Read-only diagnostic — for every currently OPEN (unsettled) travel leg, asks Google
// what it would measure and prints it next to what's stored today (the effective km
// admin/employees see, which for anything refined before the Google key existed is
// OpenRouteService's number). Writes nothing — purely a preview, so switching
// providers doesn't silently change people's pending payout figures without anyone
// seeing the before/after first. A handful of Google calls (well inside the free tier).
//
// Usage: DATABASE_URL="..." node scripts/diagnostics/compare-open-legs-google-vs-stored.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL first.')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

async function googleKm(lat1, lon1, lat2, lon2) {
  const { rows } = await client.query(
    `select road_distance_km_google(google_maps_api_key, $1::numeric, $2::numeric, $3::numeric, $4::numeric) as km
     from travel_routing_settings where id = 1`,
    [lat1, lon1, lat2, lon2]
  )
  return rows[0].km == null ? null : Number(rows[0].km)
}

const { rows: visits } = await client.query(`
  select v.id, e.name, to_char(v.date, 'YYYY-MM-DD') as day, v.emp_id, v.site_note, v.lat, v.lon, v.captured_at,
         v.leg_distance_km, v.road_leg_km, v.distance_overridden,
         a.in_lat, a.in_lon
  from travel_visits v
  join employees e on e.id = v.emp_id
  left join attendance a on a.emp_id = v.emp_id and a.date = v.date
  order by e.name, v.date, v.captured_at
`)

const out = []
const prevByDay = {}
for (const v of visits) {
  const key = `${v.emp_id}|${v.day}`
  const prev = prevByDay[key] || (v.in_lat != null ? { lat: v.in_lat, lon: v.in_lon } : null)
  const stored = v.distance_overridden ? Number(v.leg_distance_km) : Number(v.road_leg_km ?? v.leg_distance_km)
  const storedSource = v.distance_overridden ? 'adjusted' : v.road_leg_km != null ? 'ORS' : 'estimate'
  const g = prev ? await googleKm(prev.lat, prev.lon, v.lat, v.lon) : null
  out.push({ employee: v.name, day: v.day, leg: `-> ${v.site_note}`, stored_km: stored.toFixed(2), stored_source: storedSource, google_km: g == null ? 'n/a' : g.toFixed(2), _emp: v.name, _s: stored, _g: g, _adj: v.distance_overridden })
  prevByDay[key] = { lat: v.lat, lon: v.lon }
}

const { rows: returns } = await client.query(`
  select e.name, to_char(a.date, 'YYYY-MM-DD') as day, a.emp_id, a.out_lat, a.out_lon, a.travel_return_road_km
  from attendance a join employees e on e.id = a.emp_id
  where a.out_lat is not null and exists (select 1 from travel_visits v where v.emp_id = a.emp_id and v.date = a.date)
  order by e.name, a.date
`)
for (const r of returns) {
  const last = prevByDay[`${r.emp_id}|${r.day}`]
  const stored = r.travel_return_road_km != null ? Number(r.travel_return_road_km) : null
  const g = last ? await googleKm(last.lat, last.lon, r.out_lat, r.out_lon) : null
  out.push({ employee: r.name, day: r.day, leg: '-> punch out', stored_km: stored == null ? 'n/a' : stored.toFixed(2), stored_source: stored == null ? '-' : 'ORS', google_km: g == null ? 'n/a' : g.toFixed(2), _emp: r.name, _s: stored ?? 0, _g: g, _adj: false })
}

console.table(out.map(({ _emp, _s, _g, _adj, ...row }) => row))

console.log('\nPer-employee totals over these legs (manually adjusted legs excluded — a human override always wins):')
const totals = {}
for (const o of out) {
  if (o._adj || o._g == null) continue
  totals[o._emp] ||= { stored: 0, google: 0 }
  totals[o._emp].stored += o._s
  totals[o._emp].google += o._g
}
for (const [name, t] of Object.entries(totals)) {
  console.log(`${name}: stored ${t.stored.toFixed(2)} km  ->  Google ${t.google.toFixed(2)} km  (${(t.google - t.stored >= 0 ? '+' : '')}${(t.google - t.stored).toFixed(2)} km)`)
}

await client.end()
