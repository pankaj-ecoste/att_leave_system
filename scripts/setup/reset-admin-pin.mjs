#!/usr/bin/env node
// Recovery path for a forgotten admin PIN (PROGRESS.md P6-5). There's a single shared
// admin PIN, not individual admin accounts, so a self-service "forgot PIN" email flow
// doesn't apply the way it would for per-user logins — whoever holds the database
// connection string is the recovery mechanism, same as every other "raw SQL against
// production" operation this project already documents (apply-migrations.mjs,
// check-schema-contract.mjs).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/reset-admin-pin.mjs <new-pin>

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const newPin = process.argv[2]
if (!newPin || newPin.length < 4) {
  console.error('Usage: node scripts/reset-admin-pin.mjs <new-pin>   (at least 4 characters)')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()
  await client.query(
    `update app_settings set admin_pin_hash = crypt($1, gen_salt('bf')) where id = 1`,
    [newPin]
  )
  await client.query(
    `insert into audit_logs (action, detail, by_name) values ('SETTINGS_UPDATE', 'admin PIN reset via recovery script', 'system')`
  )
  console.log('Admin PIN reset successfully. Log in with the new PIN and change it again from Settings if you want a different one.')
  await client.end()
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
