#!/usr/bin/env node
// One-off, temporary: create a disposable test employee + a Submitted travel claim,
// then mark it Paid for real — so the new "Paid" line (plan.md §51) can be watched
// rendering in the actual app, not just proven at the database level.
//
// Everything created here is clearly named (prefixed ZZZ_TEST_) and meant to be
// deleted immediately after the UI check — see delete-test-paid-claim.mjs.
//
// Usage:
//   DATABASE_URL="..." node scripts/diagnostics/create-test-paid-claim.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL first.')
  process.exit(2)
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const adminTok = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '15 minutes')`, [adminTok])

    const pin = '7391'
    const { rows: [emp] } = await client.query(
      `select * from admin_create_employee($1, $2::jsonb)`,
      [adminTok, JSON.stringify({
        name: 'ZZZ_TEST_PaidClaimCheck', pin, company: 'Asma Traexim Pvt Ltd',
        workMode: 'field', jobTitle: 'TEST — delete me',
      })]
    )
    console.log('Created test employee:', emp.id, emp.name, 'emp_num', emp.emp_num)

    await client.query(`update employees set ta_rate_tier = 'executive' where id = $1`, [emp.id])

    const { rows: [claim] } = await client.query(`
      insert into travel_claims (emp_id, period_start, period_end, status, total_km, distance_amount, expense_amount, amount, rate_tier, rate_per_km, submitted_at)
      values ($1, '2026-10-01', '2026-10-10', 'Submitted', 44.3, 443.00, 150.00, 593.00, 'executive', 10, now())
      returning id`, [emp.id])
    console.log('Created Submitted claim:', claim.id)

    const paid = await client.query(`select * from admin_mark_travel_claim_paid($1, $2)`, [adminTok, claim.id])
    console.log('Marked Paid:', paid.rows[0].claim.status, '₹' + paid.rows[0].claim.amount)

    console.log('\n--- Login details for the staff-side browser check ---')
    console.log('Company:  Asma Traexim Pvt Ltd')
    console.log('Name:     ZZZ_TEST_PaidClaimCheck')
    console.log('PIN:      ' + pin)
    console.log('emp_id:   ' + emp.id)
    console.log('claim_id: ' + claim.id)
    console.log('\nWhen done checking, run delete-test-paid-claim.mjs with this emp_id to remove everything.')
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
