#!/usr/bin/env node
// One-off: apply supabase/migrations/0065_travel_photo_delete_server_side.sql (plan.md §47).
// Then removes the 3 confirmed orphan photos from failed saves via the new server-side core.
// Usage: DATABASE_URL=... node scripts/migrations/apply-0065-travel-photo-delete-server-side.mjs
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0065_travel_photo_delete_server_side.sql'), 'utf8')
const MUST_BE_UNCHANGED = ['admin_settle_travel_period', 'employee_add_travel_visit', 'travel_summary_for_employee', 'storage_sign_url_core', 'log_audit']
const hashes = async (c) => Object.fromEntries((await c.query(`select p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1::text[])`, [MUST_BE_UNCHANGED])).rows.map(r => [r.proname, r.h]))

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const before = await hashes(client)
  await client.query(sql)
  console.log('Migration 0065 applied.')
  const after = await hashes(client)
  const changed = MUST_BE_UNCHANGED.filter(n => before[n] !== after[n])
  if (changed.length) { console.error('!! unexpected changes:', changed); process.exit(1) }
  console.log(`Confirmed: ${MUST_BE_UNCHANGED.length} unrelated functions byte-identical.`)

  const { rows } = await client.query(`
    select o.name from storage.objects o where o.bucket_id = 'travel-selfies' and o.created_at > now() - interval '3 days'
      and not exists (select 1 from travel_visits v where v.photo_path = o.name or v.expense_photo_path = o.name)`)
  console.log('Orphans to remove:', rows.map(r => r.name))
  if (rows.length) {
    const { rows: res } = await client.query(`select storage_delete_objects_core('travel-selfies', $1::text[]) as ok`, [rows.map(r => r.name)])
    console.log('Server-side delete ok:', res[0].ok)
    const { rows: left } = await client.query(`select count(*)::int n from storage.objects o where o.bucket_id='travel-selfies' and o.created_at > now() - interval '3 days' and not exists (select 1 from travel_visits v where v.photo_path=o.name or v.expense_photo_path=o.name)`)
    console.log('Orphans remaining:', left[0].n)
  }
} finally {
  await client.end()
}
