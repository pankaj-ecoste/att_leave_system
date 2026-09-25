#!/usr/bin/env node
// One-off data fix (2026-09-25, plan.md §36) — after admin added a Google Maps key,
// re-measures every currently OPEN (unsettled) travel leg with Google Routes so pending
// totals match the numbers admin checks by hand. Legs measured earlier were saved from
// OpenRouteService and would otherwise never change (refinement only fills legs that
// are still empty).
//
// Deliberately overwrite-only-on-success rather than "clear then refine": if Google
// fails or returns nothing for a leg, that leg keeps its existing saved number instead
// of dropping back to the much smaller straight-line estimate. Manually adjusted legs
// (a human override) are skipped — those always win. Everything runs in ONE transaction,
// rolled back on any error, and the change is written to audit_logs.
//
// Usage: DATABASE_URL="..." node scripts/data-fixes/recalculate-open-travel-legs-with-google.mjs

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

async function totals() {
  const { rows } = await client.query(`
    select e.name, s.total_km
    from employees e cross join lateral travel_summary_for_employee(e.id) s
    where s.visit_count > 0 order by e.name
  `)
  return Object.fromEntries(rows.map(r => [r.name, Number(r.total_km)]))
}

try {
  await client.query('BEGIN')

  const before = await totals()

  const { rows: visits } = await client.query(`
    select v.id, e.name, to_char(v.date, 'YYYY-MM-DD') as day, v.emp_id, v.site_note, v.lat, v.lon,
           v.road_leg_km, v.distance_overridden, a.in_lat, a.in_lon
    from travel_visits v
    join employees e on e.id = v.emp_id
    left join attendance a on a.emp_id = v.emp_id and a.date = v.date
    order by e.name, v.date, v.captured_at
  `)

  let updated = 0
  let skipped = 0
  const prevByDay = {}
  for (const v of visits) {
    const key = `${v.emp_id}|${v.day}`
    const prev = prevByDay[key] || (v.in_lat != null ? { lat: v.in_lat, lon: v.in_lon } : null)
    prevByDay[key] = { lat: v.lat, lon: v.lon }
    if (v.distance_overridden || !prev) { skipped++; continue }
    const g = await googleKm(prev.lat, prev.lon, v.lat, v.lon)
    if (g == null) { skipped++; console.log(`  kept  ${v.name} ${v.day} -> ${v.site_note}: Google gave no value, left as is`); continue }
    await client.query(`update travel_visits set road_leg_km = $1 where id = $2`, [g, v.id])
    console.log(`  set   ${v.name} ${v.day} -> ${v.site_note}: ${Number(v.road_leg_km ?? 0).toFixed(2)} -> ${g.toFixed(2)} km`)
    updated++
  }

  const { rows: returns } = await client.query(`
    select e.name, to_char(a.date, 'YYYY-MM-DD') as day, a.emp_id, a.out_lat, a.out_lon, a.travel_return_road_km
    from attendance a join employees e on e.id = a.emp_id
    where a.out_lat is not null and exists (select 1 from travel_visits v where v.emp_id = a.emp_id and v.date = a.date)
    order by e.name, a.date
  `)
  for (const r of returns) {
    const last = prevByDay[`${r.emp_id}|${r.day}`]
    if (!last) { skipped++; continue }
    const g = await googleKm(last.lat, last.lon, r.out_lat, r.out_lon)
    if (g == null) { skipped++; console.log(`  kept  ${r.name} ${r.day} -> punch out: Google gave no value, left as is`); continue }
    await client.query(`update attendance set travel_return_road_km = $1 where emp_id = $2 and date = $3::date`, [g, r.emp_id, r.day])
    console.log(`  set   ${r.name} ${r.day} -> punch out: ${Number(r.travel_return_road_km ?? 0).toFixed(2)} -> ${g.toFixed(2)} km`)
    updated++
  }

  const after = await totals()
  console.log(`\nLegs updated: ${updated}, left unchanged: ${skipped}`)
  console.log('\nTotals (what admin/employees see and what a settlement would pay on):')
  for (const name of Object.keys(after)) {
    console.log(`  ${name}: ${before[name]?.toFixed(2)} km -> ${after[name].toFixed(2)} km`)
  }

  await client.query(
    `select log_audit('TRAVEL_LEGS_RECALCULATED', $1, 'system')`,
    [`Re-measured ${updated} open travel legs with Google Routes (previously OpenRouteService)`]
  )

  await client.query('COMMIT')
  console.log('\nCommitted.')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('FAILED — rolled back, nothing changed:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
