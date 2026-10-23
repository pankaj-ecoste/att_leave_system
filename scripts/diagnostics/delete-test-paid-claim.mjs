#!/usr/bin/env node
// Removes the disposable test employee (and everything cascaded from them — leave
// balances, sessions, settlements, etc.) created by create-test-paid-claim.mjs.
// Hard delete, not the usual soft-delete admin_delete_employee uses — this was never
// a real employee and shouldn't linger in the directory even soft-deleted.
//
// Usage:
//   DATABASE_URL="..." node scripts/diagnostics/delete-test-paid-claim.mjs <emp_id>

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL first.')
  process.exit(2)
}
const empId = process.argv[2]
if (!empId) {
  console.error('Usage: node delete-test-paid-claim.mjs <emp_id>')
  process.exit(2)
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: [emp] } = await client.query(`select name from employees where id = $1`, [empId])
    if (!emp) { console.log('No employee with that id — nothing to delete.'); return }
    if (!emp.name.startsWith('ZZZ_TEST_')) {
      console.error(`Refusing to delete "${emp.name}" — this script only deletes names starting with ZZZ_TEST_.`)
      process.exit(1)
    }
    const { rowCount } = await client.query(`delete from employees where id = $1`, [empId])
    console.log(`Deleted ${emp.name} (${rowCount} row) and everything cascaded from them.`)

    // Confirm nothing was left behind.
    const left = await client.query(`
      select
        (select count(*) from leave_balances where emp_id = $1) as leave_balances,
        (select count(*) from travel_claims where emp_id = $1) as travel_claims,
        (select count(*) from employee_sessions where emp_id = $1) as sessions`, [empId])
    console.log('Leftover rows (should all be 0):', left.rows[0])
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
