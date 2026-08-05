#!/usr/bin/env node
// Applies every supabase/migrations/*.sql file, in filename order, to whatever
// Postgres connection string is given. Per the project's Supabase-access notes: use the
// session pooler (IPv4), not the direct connection — the direct string just hangs here.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-migrations.mjs
//
// Safe to re-run: every table/index/policy/function in these migrations uses
// `if not exists` / `create or replace`, so a second run is a no-op, not a duplicate.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

// 0001_baseline_schema.sql is the OLD project's extracted schema, kept for historical
// reference only — it must never be applied to HRMS. Only 0002+ are the new schema.
const files = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql') && f !== '0001_baseline_schema.sql')
  .sort()

if (files.length === 0) {
  console.error('No migrations found to apply (besides the excluded baseline).')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()
  console.log(`Connected. Applying ${files.length} migration(s):`)
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    console.log(`  -> ${file}`)
    try {
      await client.query(sql)
    } catch (err) {
      console.error(`\nFailed applying ${file}:`)
      console.error(err.message)
      await client.end()
      process.exit(1)
    }
  }
  console.log('\nAll migrations applied successfully.')
  await client.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
