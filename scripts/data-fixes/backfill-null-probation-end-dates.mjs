#!/usr/bin/env node
// One-off data fix — Probation employees with a joining date but no probation_end_date.
// Sets end date = joining_date + 3 months. Only touches rows where the end date is NULL.
// Usage: DATABASE_URL="..." node scripts/data-fixes/backfill-null-probation-end-dates.mjs
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows } = await client.query(`
  update employees
     set probation_end_date = (joining_date + interval '3 months')::date
   where employment_status = 'Probation' and probation_end_date is null
     and joining_date is not null and deleted_at is null
  returning name, emp_num, joining_date, probation_end_date`)
console.log(`Updated ${rows.length} row(s)`)
console.table(rows)
const { rows: left } = await client.query(`
  select name, emp_num from employees
   where employment_status = 'Probation' and deleted_at is null
     and (probation_end_date is null or joining_date is null)`)
console.log('Probation employees still without an end date or joining date:', left)
await client.end()
