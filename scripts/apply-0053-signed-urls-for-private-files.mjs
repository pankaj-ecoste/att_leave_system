#!/usr/bin/env node
// One-off: apply supabase/migrations/0053_signed_urls_for_private_files.sql (plan.md §33.2).
//
// Before: confirms anon can still read both buckets directly (the gap being closed).
// Applies the migration.
// After: confirms anon can no longer read either bucket directly, and confirms the 5
// new wrapper functions exist with the correct anon-callable status (the wrappers: yes;
// the core signer: no).
//
// Does NOT set the service_role key — that's a separate, one-time step
// (scripts/set-storage-signing-key.mjs) the user runs themselves once they've fetched
// it from the Supabase dashboard. Until that's done, the new functions correctly raise
// "File viewing is not configured yet" instead of silently failing.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0053-signed-urls-for-private-files.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0053_signed_urls_for_private_files.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function bucketReadableByAnon(client, bucket) {
  const { rows } = await client.query(
    `select count(*) > 0 as any_policy from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and 'anon' = any(roles) and cmd = 'SELECT' and qual ilike '%' || $1 || '%'`,
    [bucket]
  )
  return rows[0].any_policy
}

async function fnAnonStatus(client, names) {
  const { rows } = await client.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_call
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
    order by p.proname
  `, [names])
  return rows
}

const WRAPPERS = [
  'admin_get_leave_document_url', 'manager_get_leave_document_url',
  'employee_get_own_travel_photo_url', 'manager_get_team_travel_photo_url', 'admin_get_travel_photo_url',
]
const CORE = ['storage_sign_url_core']

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    console.log('--- Before ---')
    console.log('leave-documents readable by anon:', await bucketReadableByAnon(client, 'leave-documents'))
    console.log('travel-selfies readable by anon:', await bucketReadableByAnon(client, 'travel-selfies'))

    await client.query(sql)
    console.log('\nMigration 0053 applied.\n')

    console.log('--- After ---')
    const leaveDocsOpen = await bucketReadableByAnon(client, 'leave-documents')
    const travelSelfiesOpen = await bucketReadableByAnon(client, 'travel-selfies')
    console.log('leave-documents readable by anon:', leaveDocsOpen)
    console.log('travel-selfies readable by anon:', travelSelfiesOpen)

    const wrapperStatus = await fnAnonStatus(client, WRAPPERS)
    console.table(wrapperStatus)
    const coreStatus = await fnAnonStatus(client, CORE)
    console.table(coreStatus)

    const problems = []
    if (leaveDocsOpen) problems.push('leave-documents still directly readable by anon')
    if (travelSelfiesOpen) problems.push('travel-selfies still directly readable by anon')
    for (const w of wrapperStatus) if (w.anon_can_call !== true) problems.push(`${w.proname} should be anon-callable but isn't`)
    for (const c of coreStatus) if (c.anon_can_call !== false) problems.push(`${c.proname} should NOT be anon-callable but is`)
    if (problems.length) {
      console.error('\n!! Problems found:', problems.join('; '))
      process.exit(1)
    }
    console.log('\nConfirmed: both buckets locked down, all 5 wrapper functions anon-callable, core signer is not.')
    console.log('Next step: run scripts/set-storage-signing-key.mjs once with the service_role key to make viewing actually work.')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
