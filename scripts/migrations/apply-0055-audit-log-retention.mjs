#!/usr/bin/env node
// One-off: apply supabase/migrations/0055_audit_log_retention.sql (plan.md §33.8a).
//
// Confirms the cron job exists and is scheduled correctly after applying. Does NOT
// delete anything itself right now — the job runs on its own schedule (04:00 IST
// daily) and only removes rows older than 1 year, which won't affect any real data
// today (this app is a few weeks old).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0055-audit-log-retention.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0055_audit_log_retention.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Migration 0055 applied.\n')

    const { rows } = await client.query(
      `select jobname, schedule, command, active from cron.job where jobname = 'cleanup-old-audit-logs'`
    )
    if (rows.length !== 1) {
      console.error('!! Expected exactly 1 cron job named cleanup-old-audit-logs, found', rows.length)
      process.exit(1)
    }
    console.log('Cron job confirmed:', rows[0])
    if (!rows[0].active) {
      console.error('!! Job exists but is not active')
      process.exit(1)
    }

    const { rows: [{ count: totalCount }] } = await client.query('select count(*)::int from audit_logs')
    const { rows: [{ count: overOneYear }] } = await client.query(
      `select count(*)::int from audit_logs where ts < now() - interval '1 year'`
    )
    console.log(`\naudit_logs: ${totalCount} rows total, ${overOneYear} older than 1 year (none expected — app is only weeks old).`)
    console.log('All checks passed.')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
