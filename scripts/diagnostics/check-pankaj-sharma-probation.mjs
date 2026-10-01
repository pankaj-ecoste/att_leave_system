#!/usr/bin/env node
// One-off read-only diagnostic — why is Pankaj Sharma (joined 2026-07-01) missing from the
// "completed 3 months on probation" banner on the admin Employees tab?
// The banner (Employees.jsx) only lists people where employment_status = 'Probation'
// AND probation_end_date is set AND probation_end_date <= today.
// Usage: DATABASE_URL="..." node scripts/diagnostics/check-pankaj-sharma-probation.mjs

import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows } = await client.query(`
  select name, emp_num, joining_date, employment_status, probation_end_date,
         (joining_date + interval '3 months')::date as expected_end, active, deleted_at
  from employees
  where name ilike '%pankaj%' or name ilike '%durgendra%' or name ilike '%naresh kumar%'
  order by name
`)
console.table(rows)
await client.end()
