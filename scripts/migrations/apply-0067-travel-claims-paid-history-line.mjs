#!/usr/bin/env node
// One-off: apply supabase/migrations/0067_travel_claims_paid_history_line.sql.
//
// Applies inside one transaction and COMMITS only if every check passes. Since no real
// claim has ever been marked Paid in production yet (confirmed 2026-10-23), the
// behaviour tests create disposable fake claim rows for a real employee, run inside a
// SAVEPOINT, and roll back — nothing real is touched or left behind.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0067-travel-claims-paid-history-line.mjs

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0067_travel_claims_paid_history_line.sql'), 'utf8')
const problems = []
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) problems.push(msg) }

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    console.log('Migration 0067 applied inside one transaction (commits only if every check passes).\n')

    console.log('--- Behaviour test: a real employee, 7 fake Paid claims + 1 fake Submitted, rolled back ---')
    await client.query('SAVEPOINT b')
    try {
      const { rows: [emp] } = await client.query(`select id from employees where active and deleted_at is null order by name limit 1`)
      const adminTok = '11223344-1122-1122-1122-112233445566'
      const empTok = '22334455-2233-2233-2233-223344556677'
      await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '5 minutes')`, [adminTok])
      await client.query(`insert into employee_sessions (token, emp_id) values ($1, $2)`, [empTok, emp.id])

      // 7 paid claims, 10 days apart, oldest first — only the most recent 5 should surface.
      const paidIds = []
      for (let i = 0; i < 7; i++) {
        const { rows: [c] } = await client.query(`
          insert into travel_claims (emp_id, period_start, period_end, status, total_km, distance_amount, expense_amount, amount, rate_tier, rate_per_km, submitted_at, paid_at)
          values ($1, '2026-01-01'::date + (10*$2)::int, '2026-01-05'::date + (10*$2)::int, 'Paid', 10, 100, 0, 100, 'executive', 10,
                  now() - ((7-$2) || ' days')::interval, now() - ((7-$2) || ' days')::interval)
          returning id`, [emp.id, i])
        paidIds.push(c.id)
      }
      const { rows: [submittedClaim] } = await client.query(`
        insert into travel_claims (emp_id, period_start, period_end, status, total_km, distance_amount, expense_amount, amount, rate_tier, rate_per_km, submitted_at)
        values ($1, '2026-02-01', '2026-02-05', 'Submitted', 20, 200, 0, 200, 'executive', 10, now())
        returning id`, [emp.id])

      const admin = await client.query(`select id, status from admin_get_travel_claims($1)`, [adminTok])
      const adminForThisEmp = admin.rows.filter(r => paidIds.includes(r.id) || r.id === submittedClaim.id)
      const adminPaidCount = adminForThisEmp.filter(r => r.status === 'Paid').length
      check(adminPaidCount === 5, `admin sees exactly 5 of this employee's 7 paid claims (got ${adminPaidCount})`)
      check(adminForThisEmp.some(r => r.id === submittedClaim.id), 'admin still sees the Submitted claim (not capped)')
      check(!adminForThisEmp.some(r => r.id === paidIds[0]), 'the OLDEST paid claim (not the most recent 5) is correctly excluded')
      check(adminForThisEmp.some(r => r.id === paidIds[6]), 'the MOST RECENT paid claim is correctly included')

      const emplo = await client.query(`select id, status from employee_get_travel_claims($1, $2)`, [empTok, emp.id])
      const empPaidCount = emplo.rows.filter(r => r.status === 'Paid').length
      check(empPaidCount === 5, `employee sees exactly 5 of their own 7 paid claims (got ${empPaidCount})`)
      check(emplo.rows.some(r => r.id === submittedClaim.id), 'employee still sees their Submitted claim')
    } catch (e) {
      check(false, `behaviour test error: ${e.message}`)
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT b')
      console.log('(rolled back to savepoint — no real data touched)')
    }

    if (problems.length) {
      await client.query('ROLLBACK')
      console.error(`\n${problems.length} check(s) failed — ROLLED BACK, production unchanged.`)
      process.exit(1)
    }
    await client.query('COMMIT')
    console.log('\nAll checks passed — migration COMMITTED.')
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
