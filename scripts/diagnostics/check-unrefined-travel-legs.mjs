#!/usr/bin/env node
// One-off diagnostic (not a migration) — checking whether any stored legs (into-visit
// or the return-to-punch-out leg) are still sitting on the straight-line estimate
// instead of the refined road distance, which would explain a consistent under-count
// vs Google Maps even after routing was turned on.
// Usage: DATABASE_URL="..." node scripts/debug/check-unrefined-legs.mjs

import pg from 'pg'

const client = new (await import('pg')).default.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

console.log('--- travel_visits: road_leg_km still NULL (still using straight-line estimate) ---')
const { rows: unrefinedVisits } = await client.query(`
  select e.name, v.date, v.site_note, v.leg_distance_km, v.road_leg_km, v.distance_overridden
  from travel_visits v join employees e on e.id = v.emp_id
  order by e.name, v.captured_at
`)
console.table(unrefinedVisits)

console.log('\n--- attendance: travel_return_road_km still NULL, for days that have travel visits ---')
const { rows: unrefinedReturns } = await client.query(`
  select e.name, a.date, a.out_time, a.out_lat is not null as has_punch_out_coords, a.travel_return_road_km
  from attendance a
  join employees e on e.id = a.emp_id
  where exists (select 1 from travel_visits v where v.emp_id = a.emp_id and v.date = a.date)
  order by e.name, a.date
`)
console.table(unrefinedReturns)

console.log('\n--- Full breakdown per employee: stored-leg sum vs return-leg (with source) ---')
const { rows: emps } = await client.query(`select distinct emp_id from travel_visits`)
for (const { emp_id } of emps) {
  const { rows: summary } = await client.query(`select * from travel_summary_for_employee($1)`, [emp_id])
  const { rows: name } = await client.query(`select name from employees where id = $1`, [emp_id])
  console.log(name[0].name, summary[0])
}

await client.end()
