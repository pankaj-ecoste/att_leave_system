#!/usr/bin/env node
// One-off: apply supabase/migrations/0046_travel_expenses_and_summary.sql.
// Adds optional per-visit expenses (toll/lunch/etc, receipt photo mandatory once an
// expense is entered) and a running expense total everywhere the km total already
// flows (summary, overview, settlement). See plan.md §28 follow-up.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0046-travel-expenses-and-summary.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0046_travel_expenses_and_summary.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

// Functions this migration intentionally changes (return shape or body) — excluded
// from the "must not change" guardrail below, checked separately instead.
const EXPECTED_TO_CHANGE = [
  'employee_add_travel_visit', 'travel_summary_for_employee', 'employee_get_travel_summary',
  'manager_get_team_travel_summary', 'admin_get_travel_overview', 'admin_settle_travel_period',
]

const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'admin_create_employee', 'fetch_directory',
  'is_valid_admin_token', 'is_valid_employee_token', 'log_audit', 'haversine_m',
  'employee_get_travel_journey', 'admin_get_employee_travel_journey', 'manager_get_team_travel_journey',
  'admin_set_ta_rate_tier', 'admin_get_ta_settings', 'admin_update_ta_settings', 'admin_override_travel_visit_distance',
]

async function fnHashes(client, names) {
  const { rows } = await client.query(`
    select p.proname, md5(pg_get_functiondef(p.oid)) as hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
  `, [names])
  return Object.fromEntries(rows.map(r => [r.proname, r.hash]))
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const before = await fnHashes(client, MUST_BE_UNCHANGED)

    await client.query(sql)
    console.log('Migration 0046 applied.')

    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    let changed = false
    for (const name of MUST_BE_UNCHANGED) {
      if (before[name] !== after[name]) {
        console.error(`  !! ${name} changed unexpectedly (before=${before[name]}, after=${after[name]})`)
        changed = true
      }
    }
    if (changed) {
      console.error('Aborting verification: an unrelated function changed. Investigate immediately.')
      process.exit(1)
    }
    console.log('Confirmed:', MUST_BE_UNCHANGED.length, 'functions outside this migration are byte-identical to before.')

    const { rows: changedFns } = await client.query(`
      select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname = any($1::text[])
    `, [EXPECTED_TO_CHANGE])
    console.log(`Functions expected to change, still present: ${changedFns.length}/${EXPECTED_TO_CHANGE.length}`)

    const { rows: cols } = await client.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'travel_visits' and column_name in ('expense_note', 'expense_amount', 'expense_photo_path'))
        or (table_name = 'travel_settlements' and column_name = 'expense_amount')
      )
    `)
    console.log('New expense columns present:', cols.map(c => `${c.table_name}.${c.column_name}`))

    // Sanity check the array-concat fix for the "no expenses this period" case: settle
    // logic must never null out photo_paths when there are zero expense receipts.
    const { rows: test } = await client.query(`
      select coalesce(array_agg('a'::text), '{}'::text[]) || coalesce(array_agg(null::text) filter (where false), '{}'::text[]) as paths
    `)
    console.log('Array-concat null-safety check (should be ["a"]):', test[0].paths)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
