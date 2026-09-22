#!/usr/bin/env node
// One-off: apply supabase/migrations/0045_travel_selfies_delete_policy_fix.sql.
// Security fix for a same-session finding (see the migration file's header): 0044 added
// an anon delete policy on storage.objects for travel-selfies with zero scoping — since
// the anon key is public, that was the entire access check, letting anyone delete any
// employee's TA evidence directly, bypassing admin_settle_travel_period's admin-token
// check entirely. This migration drops that policy and moves the deletion inside the
// function itself (SECURITY DEFINER already bypasses storage RLS the same way it
// bypasses travel_visits' RLS).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0045-travel-selfies-delete-policy-fix.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0045_travel_selfies_delete_policy_fix.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

// Same "must not touch anything pre-existing" guardrail as 0044's apply script — this
// migration only redefines admin_settle_travel_period, a function this same session
// created in 0044, so it's the one function EXPECTED to change here.
const MUST_BE_UNCHANGED = [
  'employee_punch', 'admin_update_employee', 'admin_create_employee', 'fetch_directory',
  'is_valid_admin_token', 'is_valid_employee_token', 'log_audit', 'haversine_m',
  'employee_add_travel_visit', 'employee_get_travel_journey', 'admin_get_travel_overview',
  'admin_set_ta_rate_tier', 'travel_summary_for_employee',
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
    console.log('Migration 0045 applied.')

    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    let changed = false
    for (const name of MUST_BE_UNCHANGED) {
      if (before[name] !== after[name]) {
        console.error(`  !! ${name} changed — this must NOT happen (before=${before[name]}, after=${after[name]})`)
        changed = true
      }
    }
    if (changed) {
      console.error('Aborting verification: an unrelated function changed. Investigate immediately.')
      process.exit(1)
    }
    console.log('Confirmed: all', MUST_BE_UNCHANGED.length, 'functions that should NOT have changed are byte-identical to before.')

    const { rows: policies } = await client.query(`
      select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and qual::text like '%travel-selfies%'
    `)
    console.log('Remaining travel-selfies storage policies:', policies)
    const hasDelete = policies.some(p => p.cmd === 'DELETE')
    console.log('Anon delete policy still present:', hasDelete, hasDelete ? '(SHOULD BE FALSE)' : '(correct — removed)')

    const { rows: fn } = await client.query(`
      select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_settle_travel_period'
    `)
    const def = fn[0]?.def || ''
    console.log('admin_settle_travel_period now deletes storage.objects directly:', def.includes("delete from storage.objects"))
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
