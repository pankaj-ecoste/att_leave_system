#!/usr/bin/env node
// One-off: apply supabase/migrations/0054_paginate_remaining_admin_lists.sql (plan.md §33.3).
//
// Before: confirms the 3 old (unpaginated) function signatures exist.
// Applies the migration (drops+recreates 3 with new p_limit/p_offset params, updates
// admin_get_leave_accruals' body only since its signature is unchanged).
// After: confirms the old 3-arg/1-arg/2-arg signatures are gone (no orphaned overload,
// the exact Day-3 admin_update_settings bug class), the new signatures exist and are
// anon-callable, and proves real pagination correctness the same way §29's fix was
// proven — a page size smaller than the total row count must still return every row
// with no duplicates.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0054-paginate-remaining-admin-lists.mjs

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

const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0054_paginate_remaining_admin_lists.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

async function fnExists(client, name, argTypes) {
  const { rows } = await client.query(`
    select count(*) > 0 as exists from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1
      and pg_get_function_identity_arguments(p.oid) = $2
  `, [name, argTypes])
  return rows[0].exists
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    console.log('--- Before: old (unpaginated) signatures exist? ---')
    console.log('admin_get_all_location_logs(uuid, date):', await fnExists(client, 'admin_get_all_location_logs', 'p_token uuid, p_date date'))
    console.log('admin_get_comp_off_payouts(uuid, date):', await fnExists(client, 'admin_get_comp_off_payouts', 'p_token uuid, p_period date'))
    console.log('admin_get_regularizations(uuid):', await fnExists(client, 'admin_get_regularizations', 'p_token uuid'))

    await client.query(sql)
    console.log('\nMigration 0054 applied.\n')

    console.log('--- After: old signatures gone, no orphaned overload? ---')
    const oldLocGone = !(await fnExists(client, 'admin_get_all_location_logs', 'p_token uuid, p_date date'))
    const oldPayoutsGone = !(await fnExists(client, 'admin_get_comp_off_payouts', 'p_token uuid, p_period date'))
    const oldRegsGone = !(await fnExists(client, 'admin_get_regularizations', 'p_token uuid'))
    console.log('old admin_get_all_location_logs gone:', oldLocGone)
    console.log('old admin_get_comp_off_payouts gone:', oldPayoutsGone)
    console.log('old admin_get_regularizations gone:', oldRegsGone)

    console.log('\n--- After: new signatures exist and anon-callable? ---')
    const { rows: fns } = await client.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args,
        has_function_privilege('anon', p.oid, 'execute') as anon_can_call
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in
        ('admin_get_all_location_logs', 'admin_get_comp_off_payouts', 'admin_get_regularizations', 'admin_get_leave_accruals')
      order by p.proname
    `)
    console.table(fns)

    let problems = []
    if (!oldLocGone || !oldPayoutsGone || !oldRegsGone) problems.push('an old signature is still callable (orphaned overload)')
    for (const f of fns) if (f.anon_can_call !== true) problems.push(`${f.proname} should be anon-callable but isn't`)

    // Pagination-correctness proof (same shape as §29's own test): a real admin token,
    // fetch every regularization_requests row with a page size of 1 to force multiple
    // batches, confirm the count matches a plain unpaginated count and there are no
    // duplicate ids. Wrapped in a transaction, rolled back — nothing written.
    console.log('\n--- Pagination correctness proof (page size 1, rolled back) ---')
    await client.query('BEGIN')
    try {
      const testToken = '44444444-4444-4444-4444-444444444444'
      await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '5 minutes')`, [testToken])
      const { rows: [{ count: trueCount }] } = await client.query(`select count(*)::int from regularization_requests`)

      let all = []
      let offset = 0
      for (;;) {
        const { rows: page } = await client.query(
          `select * from admin_get_regularizations($1, 1, $2)`, [testToken, offset]
        )
        if (page.length === 0) break
        all.push(...page)
        offset += page.length
        if (offset > trueCount + 5) { throw new Error('pagination did not terminate correctly') }
      }
      const uniqueIds = new Set(all.map(r => r.id)).size
      console.log(`regularization_requests: true count ${trueCount}, paginated fetch got ${all.length} rows, ${uniqueIds} unique ids`)
      if (all.length !== trueCount || uniqueIds !== trueCount) {
        problems.push(`pagination mismatch: expected ${trueCount}, got ${all.length} rows / ${uniqueIds} unique`)
      } else {
        console.log('Pagination correctness confirmed: no duplicates, no gaps.')
      }
    } finally {
      await client.query('ROLLBACK')
      console.log('Rolled back — no real data touched.')
    }

    if (problems.length) {
      console.error('\n!! Problems found:', problems.join('; '))
      process.exit(1)
    }
    console.log('\nAll checks passed.')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
