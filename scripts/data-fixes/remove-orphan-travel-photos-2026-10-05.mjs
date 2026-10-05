#!/usr/bin/env node
// One-off data fix (2026-10-05, plan.md §47): removes travel-selfies photos from failed
// visit saves that never got linked to a visit row. Lists them with the DB (read-only), then
// deletes through the Storage API with the app's public key — the same orphan-only delete
// policy the app already uses (0053/0062), so a photo a visit still uses can't be removed.
// Usage: DATABASE_URL=... node scripts/data-fixes/remove-orphan-travel-photos-2026-10-05.mjs [--apply]
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const apply = process.argv.includes('--apply')
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map(l => l.split(/=(.*)/).slice(0, 2)))
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows } = await client.query(`
  select o.name from storage.objects o
  where o.bucket_id = 'travel-selfies' and o.created_at > now() - interval '3 days'
    and not exists (select 1 from travel_visits v where v.photo_path = o.name or v.expense_photo_path = o.name)
  order by o.created_at`)
await client.end()
console.log('Orphan photos found:', rows.map(r => r.name))
if (!apply) { console.log('Dry run — add --apply to delete.'); process.exit(0) }
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
const { data, error } = await supabase.storage.from('travel-selfies').remove(rows.map(r => r.name))
console.log(error ? `Failed: ${error.message}` : `Removed ${data.length} file(s).`)
