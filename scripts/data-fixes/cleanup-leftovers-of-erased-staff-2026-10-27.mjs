#!/usr/bin/env node
// Last clean-up after the 38 removed staff were erased (plan.md §57): remove what they left behind so the database
// holds data of the 83 real staff only.
//   1. attendance_monthly_summary rows whose emp_id is not an employee   (expected 57)
//   2. travel_daily_archive rows whose emp_id is not an employee         (expected 2)
//   3. the 3 travel-selfies photos of the erased visits, deleted with the database's own server-side helper
//      storage_delete_objects_core (migration 0065). The plain client call (supabase.storage.remove with the public
//      key) silently removes nothing since 0053 took away anon's read access — tried first on 2026-10-27, it answered
//      "0 files" and the photos stayed.
// The audit log is deliberately left alone.
//
// Safe to re-run: if the DB rows are already gone (0 / 0) that step is skipped and only the photos are handled.
// DEFAULT = DRY RUN (DB part rolled back; photos only listed). --apply: JSON backup of the 59 rows first (only when
// there are rows to delete), DB commit, then photo removal, then a re-check that the photos are gone.
// Usage: DATABASE_URL=... node scripts/data-fixes/cleanup-leftovers-of-erased-staff-2026-10-27.mjs [--apply]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const PHOTOS = [
  '7e5bd837-ab97-4f58-8ba8-e44e94a89e1c/selfie.jpg',
  'b03bf806-8d77-41fe-8ccc-8d22636ef16c/selfie.jpg',
  '43d3e09d-2816-48b2-9eec-bfca1e903119/selfie.jpg',
] // from the full backup of the erased visits (travel_visits.photo_path)
const BUCKET = 'travel-selfies'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows: summary } = await client.query(`select * from attendance_monthly_summary where emp_id not in (select id from employees)`)
  const { rows: archive } = await client.query(`select * from travel_daily_archive where emp_id not in (select id from employees)`)
  console.log(`attendance_monthly_summary leftovers: ${summary.length}   travel_daily_archive leftovers: ${archive.length}`)
  const dbDone = summary.length === 0 && archive.length === 0
  if (!dbDone && (summary.length !== 57 || archive.length !== 2)) throw new Error('Counts are not the expected 57 / 2 — nothing changed')

  // photos: present in Storage, and not used by any visit or expense
  const { rows: objs } = await client.query(`select name from storage.objects where bucket_id = $1 and name = any($2)`, [BUCKET, PHOTOS])
  const { rows: used } = await client.query(`select 1 from travel_visits where photo_path = any($1) or expense_photo_path = any($1) union all select 1 from travel_expenses where photo_path = any($1)`, [PHOTOS])
  console.log(`photos found in storage: ${objs.length} of ${PHOTOS.length}; still used by a record: ${used.length}`)
  if (used.length) throw new Error('A photo is still used by a record — refusing')

  if (APPLY && !dbDone) {
    fs.mkdirSync('C:\\ecoste\\backups', { recursive: true })
    const file = `C:\\ecoste\\backups\\leftovers-of-erased-staff-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
    fs.writeFileSync(file, JSON.stringify({ summary, archive, photos: PHOTOS }, null, 2))
    console.log('Backup written:', file)
  }

  await client.query('begin')
  if (dbDone) console.log('DB rows already cleaned earlier — skipping that step.')
  const a = await client.query(`delete from attendance_monthly_summary where emp_id not in (select id from employees)`)
  const b = await client.query(`delete from travel_daily_archive where emp_id not in (select id from employees)`)
  console.log(`deleted: ${a.rowCount} summary rows, ${b.rowCount} archive rows`)
  if (!dbDone && (a.rowCount !== 57 || b.rowCount !== 2)) throw new Error('Unexpected delete counts — rolled back')
  if (!APPLY) { await client.query('rollback'); console.log('\nDRY RUN — rolled back; photos not touched. Re-run with --apply.') }
  else {
    await client.query('commit'); console.log('DB step COMMITTED.')
    if (objs.length) {
      const { rows: [res] } = await client.query(`select storage_delete_objects_core($1, $2::text[]) as ok`, [BUCKET, objs.map(o => o.name)])
      console.log(`storage_delete_objects_core returned: ${res.ok}`)
    }
    const { rows: left } = await client.query(`select name from storage.objects where bucket_id = $1 and name = any($2)`, [BUCKET, PHOTOS])
    console.log(left.length ? `STILL in storage: ${left.map(l => l.name).join(', ')}` : 'Photos are gone from storage.')
  }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
