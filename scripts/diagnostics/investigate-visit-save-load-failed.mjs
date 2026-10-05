#!/usr/bin/env node
// Read-only diagnostic — "Load failed" on Save Visit (staff phone, 2026-10-05). Checks what
// reached the database and storage, the storage bucket limits, and every storage policy that
// applies to the travel-selfies bucket for the anon role.
// Usage: DATABASE_URL="..." node scripts/diagnostics/investigate-visit-save-load-failed.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

console.log('--- Himanshu: visits saved today (IST) ---')
const { rows: visits } = await client.query(`
  select v.site_note, to_char(v.captured_at at time zone 'Asia/Kolkata','HH24:MI:SS') as at_ist,
         v.expense_note, v.expense_amount, v.photo_path, v.expense_photo_path
  from travel_visits v join employees e on e.id = v.emp_id
  where e.name ilike '%himanshu%bansal%' and v.captured_at > now() - interval '2 days'
  order by v.captured_at desc`)
console.table(visits)

console.log('--- Storage: travel-selfies bucket config ---')
const { rows: bucket } = await client.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='travel-selfies'`)
console.log(bucket[0])

console.log('--- Storage: recent objects in travel-selfies (last 2 days) ---')
const { rows: objs } = await client.query(`
  select name, metadata->>'mimetype' as mime, (metadata->>'size')::bigint as bytes, created_at
  from storage.objects where bucket_id='travel-selfies' and created_at > now() - interval '2 days'
  order by created_at desc limit 20`)
console.table(objs)

console.log('--- Storage: policies on storage.objects that touch travel-selfies ---')
const { rows: pol } = await client.query(`
  select policyname, cmd, roles::text, qual, with_check from pg_policies
  where schemaname='storage' and tablename='objects' and (qual::text like '%travel%' or with_check::text like '%travel%')`)
console.table(pol)

await client.end()
