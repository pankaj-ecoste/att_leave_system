#!/usr/bin/env node
// READ-ONLY diagnostic (plan.md §41) — "staff is exactly at the office but the app says
// outside". Measures how noisy the GPS readings behind real punches are compared with the
// office radius, and whether the address text for one office is consistent.
//
// What it answers:
//   * How big is the radius, and how close to its edge do ordinary, ACCEPTED punches land?
//     (If normal punches already sit at 70-100% of the radius, GPS noise alone is enough to
//     push an honest person outside it.)
//   * How poor are the GPS readings (accuracy in metres) behind punches?
//   * For one office, how many DIFFERENT address labels do punches carry? (labels come from
//     OpenStreetMap, not our coordinates.)
// A rejected punch leaves NO record anywhere today, so this can only see the accepted ones —
// that blind spot is itself one of the findings.
//
// Only SELECTs. Nothing is changed.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/diagnostics/gps-geofence-review.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const DAYS = 45

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: sites } = await client.query(`select name, latitude, longitude, radius_m, active from sites order by name`)
    console.log('\n== Office sites (the radius is the hard limit the server enforces) ==')
    console.table(sites)

    const { rows: bySite } = await client.query(`
      select s.name, s.radius_m,
             count(*)::int as punches,
             round(percentile_cont(0.5) within group (order by a.in_distance_m)::numeric) as median_dist_m,
             round(percentile_cont(0.9) within group (order by a.in_distance_m)::numeric) as p90_dist_m,
             round(max(a.in_distance_m)) as max_dist_m,
             count(*) filter (where a.in_distance_m > 0.7 * s.radius_m)::int as within_30pct_of_edge,
             round(percentile_cont(0.5) within group (order by a.in_accuracy_m)::numeric) as median_acc_m,
             round(percentile_cont(0.9) within group (order by a.in_accuracy_m)::numeric) as p90_acc_m,
             count(*) filter (where a.in_accuracy_m > s.radius_m)::int as acc_worse_than_radius
        from attendance a join sites s on s.id = a.in_matched_site_id
       where a.date > current_date - $1::int and a.in_distance_m is not null
       group by s.name, s.radius_m order by punches desc`, [DAYS])
    console.log(`\n== Accepted punch-ins per office, last ${DAYS} days: how far from the office point, and how good the GPS was ==`)
    console.table(bySite)

    const { rows: buckets } = await client.query(`
      select case when in_accuracy_m <= 20 then '1. <=20m (excellent)'
                  when in_accuracy_m <= 50 then '2. 21-50m'
                  when in_accuracy_m <= 100 then '3. 51-100m (accepted as "good")'
                  when in_accuracy_m <= 200 then '4. 101-200m'
                  when in_accuracy_m <= 500 then '5. 201-500m'
                  else '6. >500m (cell tower / Wi-Fi guess)' end as gps_accuracy,
             count(*)::int as punches
        from attendance where date > current_date - $1::int and in_accuracy_m is not null
       group by 1 order by 1`, [DAYS])
    console.log(`\n== GPS accuracy of ALL punch-ins, last ${DAYS} days (the phone's own "I could be off by this much") ==`)
    console.table(buckets)

    const { rows: labels } = await client.query(`
      select s.name as office, a.in_location as address_label, count(*)::int as punches
        from attendance a join sites s on s.id = a.in_matched_site_id
       where a.date > current_date - $1::int and a.in_location is not null
       group by s.name, a.in_location order by s.name, punches desc`, [DAYS])
    const perOffice = new Map()
    for (const r of labels) {
      if (!perOffice.has(r.office)) perOffice.set(r.office, [])
      perOffice.get(r.office).push(r)
    }
    console.log('\n== Address text saved with punches that were ACCEPTED inside each office (top 5 per office) ==')
    for (const [office, rows] of perOffice) {
      console.log(`\n-- ${office}: ${rows.length} different address texts`)
      for (const r of rows.slice(0, 5)) console.log(`   ${String(r.punches).padStart(4)}x  ${String(r.address_label).slice(0, 110)}`)
    }

    const { rows: poor } = await client.query(`
      select e.name, count(*)::int as poor_punches,
             round(avg(a.in_accuracy_m)) as avg_acc_m, round(max(a.in_accuracy_m)) as worst_acc_m
        from attendance a join employees e on e.id = a.emp_id
       where a.date > current_date - $1::int and a.in_accuracy_m > 100
       group by e.name order by poor_punches desc limit 12`, [DAYS])
    console.log(`\n== Employees whose punch-in GPS was worse than 100m most often (last ${DAYS} days) ==`)
    console.table(poor)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
