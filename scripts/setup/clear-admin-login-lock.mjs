#!/usr/bin/env node
// Recovery path for an admin locked out of the admin login (plan.md §37). Normally the
// per-device lock is only 20 minutes and affects one phone, so this is rarely needed — it is
// for the company-wide cap (30 wrong PINs from all devices in 20 minutes) if it ever trips
// while the real admin needs in NOW. It only clears the failed-attempt rows; the PIN itself
// is untouched (use reset-admin-pin.mjs for a forgotten PIN).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/setup/clear-admin-login-lock.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()
  const { rowCount } = await client.query('delete from admin_login_failures')
  await client.query(
    `insert into audit_logs (action, detail, by_name) values ('ADMIN_LOGIN_LOCK_CLEARED', 'admin login lock cleared via recovery script', 'system')`
  )
  console.log(`Cleared ${rowCount} failed-attempt record(s). Admin login is unlocked on every device.`)
  await client.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
