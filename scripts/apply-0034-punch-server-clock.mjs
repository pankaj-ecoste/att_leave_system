#!/usr/bin/env node
// One-off: apply supabase/migrations/0034_punch_uses_server_clock.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see
// plan.md §13 / memory hrms-employee-session-expiry-fix-2026-08-20). This migration
// only does `create or replace function employee_punch(...)` — no table/data changes.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0034-punch-server-clock.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0034_punch_uses_server_clock.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Applied 0034_punch_uses_server_clock.sql — employee_punch redefined.')
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
