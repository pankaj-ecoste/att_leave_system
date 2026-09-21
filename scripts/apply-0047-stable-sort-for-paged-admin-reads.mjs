#!/usr/bin/env node
// One-off: apply supabase/migrations/0047_stable_sort_for_paged_admin_reads.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see plan.md
// §13). Adds a unique tiebreaker to the sort of admin_get_attendance and admin_get_leaves
// so batched LIMIT/OFFSET reads can never duplicate or skip a row. See plan.md §29.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0047-stable-sort-for-paged-admin-reads.mjs

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

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0047_stable_sort_for_paged_admin_reads.sql'), 'utf8')

const CHECKS = [
  { fn: 'admin_get_attendance', marker: 'order by a.date desc, e.name, a.emp_id' },
  { fn: 'admin_get_leaves', marker: 'order by date desc, id' },
]

async function getFnDef(client, fn) {
  const { rows } = await client.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1
  `, [fn])
  return rows[0]?.def || ''
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    for (const { fn, marker } of CHECKS) {
      console.log(`Before: ${fn} already has the stable sort:`, (await getFnDef(client, fn)).includes(marker))
    }

    await client.query(sql)
    console.log('Applied 0047_stable_sort_for_paged_admin_reads.sql.')

    for (const { fn, marker } of CHECKS) {
      const ok = (await getFnDef(client, fn)).includes(marker)
      console.log(`After:  ${fn} has the stable sort:`, ok)
      if (!ok) { console.error(`FATAL: ${fn} is missing the expected sort after applying.`); process.exit(1) }
    }

    // The anon grant is what lets the app call these — CREATE OR REPLACE keeps it, but verify.
    const { rows } = await client.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('admin_get_attendance', 'admin_get_leaves')
    `)
    for (const r of rows) {
      console.log(`anon can execute ${r.proname}:`, r.anon_exec)
      if (!r.anon_exec) { console.error(`FATAL: anon lost execute on ${r.proname}.`); process.exit(1) }
    }
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
