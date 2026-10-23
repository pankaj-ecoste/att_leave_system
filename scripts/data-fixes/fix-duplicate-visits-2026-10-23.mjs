#!/usr/bin/env node
// plan.md §52 — remove visits that were saved more than once, and correct the submitted claims that
// had paid for them.
//
// What counts as a repeat: the same person, same day, same site name (ignoring capitals/spaces), each
// copy saved within 10 minutes of the previous one, all within 200 m of the row we keep. In each group
// we keep ONE row — the one with the real leg (largest straight-line distance; ties → earliest) — and
// delete the copies. A lone expense that only a copy carried is moved to the kept row first. A group
// is left UNTOUCHED (listed for manual review) if its copies carry different expenses, if its rows sit
// in different claims, or if a copy is more than 200 m from the kept row.
//
// Safety:
//   * DEFAULT = DRY RUN: everything runs in one transaction that is rolled back; the plan is printed.
//   * A full JSON backup of the travel tables is written to C:\ecoste\backups BEFORE anything else.
//   * Deleting a visit normally adds it to the analytics archive (travel_daily_archive, incl. a second
//     copy of the return leg). That trigger is paused for this delete only, and the script checks that
//     the archive table is byte-for-byte unchanged afterwards.
//   * Submitted claims are adjusted by exactly what was removed (km x the claim's own rate, expenses).
//   * Photo FILES of the deleted copies are NOT removed unless --delete-photos is also given (run it
//     later, after HR has looked at the receipts; the paths are kept in the backup).
//
// Usage: DATABASE_URL=... node scripts/data-fixes/fix-duplicate-visits-2026-10-23.mjs [--apply] [--delete-photos]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const DELETE_PHOTOS = process.argv.includes('--delete-photos')
const RADIUS_M = 200
const WINDOW_S = 600
const TRIGGER = 'trg_archive_deleted_travel_visits'
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const effKm = v => Number(v.distance_overridden ? v.leg_distance_km : (v.road_leg_km ?? v.leg_distance_km))

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
let exitCode = 0
try {
  // ---------- 1. backup ----------
  const tables = {}
  for (const t of ['travel_visits', 'travel_expenses', 'travel_claims', 'travel_settlements', 'travel_daily_archive']) {
    tables[t] = (await client.query(`select * from ${t}`)).rows
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  fs.mkdirSync('C:/ecoste/backups', { recursive: true })
  const backupFile = `C:/ecoste/backups/travel-before-duplicate-cleanup-${stamp}.json`
  fs.writeFileSync(backupFile, JSON.stringify(tables))
  console.log(`Backup written: ${backupFile}  (${Object.entries(tables).map(([k, v]) => `${k} ${v.length}`).join(', ')})\n`)

  // ---------- 2. find the groups ----------
  const { rows: visits } = await client.query(`
    select v.*, v.date::text as date_txt, e.name as emp_name from travel_visits v join employees e on e.id = v.emp_id
    order by v.emp_id, v.date, v.captured_at, v.created_at`)
  const byKey = new Map()
  for (const v of visits) {
    const k = `${v.emp_id}|${v.date_txt}|${norm(v.site_note)}`
    ;(byKey.get(k) || byKey.set(k, []).get(k)).push(v)
  }
  const clusters = []
  for (const g of byKey.values()) {
    let cur = [g[0]]
    for (const v of g.slice(1)) {
      if ((v.captured_at - cur[cur.length - 1].captured_at) / 1000 <= WINDOW_S) cur.push(v)
      else { clusters.push(cur); cur = [v] }
    }
    clusters.push(cur)
  }
  const repeated = clusters.filter(c => c.length > 1)

  const plan = [] // groups we will fix
  const manual = [] // groups left alone
  for (const cl of repeated) {
    const keeper = [...cl].sort((a, b) => Number(b.leg_distance_km) - Number(a.leg_distance_km) || a.created_at - b.created_at)[0]
    const copies = cl.filter(v => v !== keeper)
    const label = `${keeper.emp_name} · ${keeper.date_txt} · ${keeper.site_note}`
    const farCopy = copies.find(c => haversineM(Number(keeper.lat), Number(keeper.lon), Number(c.lat), Number(c.lon)) > RADIUS_M)
    if (farCopy) { manual.push({ label, why: 'a copy is more than 200 m from the kept row' }); continue }
    const claimIds = new Set(cl.map(v => v.claim_id || 'none'))
    if (claimIds.size > 1) { manual.push({ label, why: 'rows belong to different claims' }); continue }
    const copyExp = copies.filter(c => Number(c.expense_amount) > 0)
    const keeperExp = Number(keeper.expense_amount) > 0 ? Number(keeper.expense_amount) : 0
    let move = null
    if (copyExp.length) {
      const amounts = new Set(copyExp.map(c => Number(c.expense_amount)))
      if (keeperExp) {
        if (amounts.size > 1 || !amounts.has(keeperExp)) { manual.push({ label, why: `copies carry different expenses (${[...amounts].join(' / ')}) than the kept row (${keeperExp})` }); continue }
      } else {
        if (amounts.size > 1) { manual.push({ label, why: `copies carry different expenses (${[...amounts].join(' / ')})` }); continue }
        move = copyExp[0] // the one real expense moves to the kept row
      }
    }
    const removedKm = copies.reduce((s, c) => s + effKm(c), 0)
    const removedExpense = copies.reduce((s, c) => s + (Number(c.expense_amount) || 0), 0) - (move ? Number(move.expense_amount) : 0)
    const dropPhotos = copies.flatMap(c => [c.photo_path, c.expense_photo_path === move?.expense_photo_path ? null : c.expense_photo_path]).filter(Boolean)
    plan.push({ label, keeper, copies, move, removedKm, removedExpense, claimId: keeper.claim_id || null, dropPhotos, name: keeper.emp_name })
  }

  console.log(`Repeated groups found: ${repeated.length} | will fix: ${plan.length} | left for manual review: ${manual.length}`)
  console.table(plan.map(p => ({
    group: p.label, rows: p.copies.length + 1, delete: p.copies.length,
    'km removed': +p.removedKm.toFixed(2), '₹ expense removed': p.removedExpense, 'expense moved to kept row': p.move ? Number(p.move.expense_amount) : '', 'in claim': p.claimId ? 'yes' : 'no',
  })))
  if (manual.length) { console.log('LEFT UNTOUCHED (needs a person to decide):'); console.table(manual) }

  // ---------- 3. claims that need adjusting ----------
  const { rows: claims } = await client.query(`select c.*, c.period_start::text as ps, c.period_end::text as pe, e.name as emp_name from travel_claims c join employees e on e.id = c.emp_id`)
  const adjustments = []
  for (const c of claims) {
    const mine = plan.filter(p => p.claimId === c.id)
    if (!mine.length) continue
    const km = mine.reduce((s, p) => s + p.removedKm, 0)
    const exp = mine.reduce((s, p) => s + p.removedExpense, 0)
    const newKm = Number(c.total_km) - km
    const newDist = round2(newKm * Number(c.rate_per_km))
    const newExp = round2(Number(c.expense_amount) - exp)
    adjustments.push({ claim: c, km, exp, newKm, newDist, newExp, newAmount: round2(newDist + newExp) })
  }
  console.log('\nSubmitted claims that will change:')
  console.table(adjustments.map(a => ({
    employee: a.claim.emp_name, period: `${a.claim.ps} → ${a.claim.pe}`, status: a.claim.status,
    'km before': +Number(a.claim.total_km).toFixed(2), 'km removed': +a.km.toFixed(2), 'km after': +a.newKm.toFixed(2),
    '₹ expenses before': Number(a.claim.expense_amount), '₹ expenses removed': a.exp, '₹ expenses after': a.newExp,
    '₹ amount before': Number(a.claim.amount), '₹ amount after': a.newAmount, 'change ₹': round2(a.newAmount - Number(a.claim.amount)),
  })))
  const paid = adjustments.filter(a => a.claim.status !== 'Submitted')
  if (paid.length) throw new Error('A claim that is already Paid is affected — stopping; this needs a decision, not a script.')

  // ---------- 4. do it (in a transaction) ----------
  const archiveBefore = (await client.query(`select count(*)::int n, coalesce(sum(visits),0)::int v, coalesce(sum(km),0)::numeric km from travel_daily_archive`)).rows[0]
  const visitsBefore = (await client.query(`select count(*)::int n from travel_visits`)).rows[0].n
  await client.query('begin')
  await client.query(`alter table public.travel_visits disable trigger ${TRIGGER}`)
  for (const p of plan) {
    if (p.move) {
      await client.query(`update travel_visits set expense_note = $2, expense_amount = $3, expense_photo_path = $4 where id = $1`,
        [p.keeper.id, p.move.expense_note, p.move.expense_amount, p.move.expense_photo_path])
    }
    // the moved receipt path is also on a copy: clear it there first so deleting the copy cannot orphan it
    for (const c of p.copies) {
      if (p.move && c.id === p.move.id) await client.query(`update travel_visits set expense_photo_path = null where id = $1`, [c.id])
    }
    await client.query(`delete from travel_visits where id = any($1::uuid[])`, [p.copies.map(c => c.id)])
  }
  await client.query(`alter table public.travel_visits enable trigger ${TRIGGER}`)
  for (const a of adjustments) {
    await client.query(`update travel_claims set total_km = $2, distance_amount = $3, expense_amount = $4, amount = $5 where id = $1`,
      [a.claim.id, a.newKm, a.newDist, a.newExp, a.newAmount])
  }
  const removedRows = plan.reduce((s, p) => s + p.copies.length, 0)
  await client.query(`select log_audit('TRAVEL_DUPLICATES_REMOVED', $1, 'admin')`,
    [`${removedRows} duplicate visit row(s) removed in ${plan.length} group(s); ${adjustments.length} submitted claim(s) corrected`])

  // ---------- 5. checks ----------
  const archiveAfter = (await client.query(`select count(*)::int n, coalesce(sum(visits),0)::int v, coalesce(sum(km),0)::numeric km from travel_daily_archive`)).rows[0]
  const visitsAfter = (await client.query(`select count(*)::int n from travel_visits`)).rows[0].n
  const trig = (await client.query(`select tgenabled from pg_trigger where tgname = $1`, [TRIGGER])).rows[0]
  const check = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) exitCode = 1 }
  console.log('')
  check(visitsBefore - visitsAfter === removedRows, 'exactly the planned number of rows were deleted', `${visitsBefore} → ${visitsAfter}`)
  check(JSON.stringify(archiveBefore) === JSON.stringify(archiveAfter), 'analytics archive unchanged (the duplicates were removed, not archived)', JSON.stringify(archiveAfter))
  check(trig?.tgenabled === 'O', 'archive trigger is switched back on')
  const orphanMoved = plan.filter(p => p.move).length
    ? (await client.query(`select count(*)::int n from travel_visits where id = any($1::uuid[]) and expense_photo_path is not null`, [plan.filter(p => p.move).map(p => p.keeper.id)])).rows[0].n
    : 0
  check(orphanMoved === plan.filter(p => p.move).length, 'every moved expense is on its kept row with its receipt photo')
  // re-scan: only the manual-review groups may remain
  const { rows: after } = await client.query(`
    select v.id, v.emp_id, v.date::text as date, v.site_note, v.captured_at from travel_visits v order by v.emp_id, v.date, v.captured_at`)
  const g2 = new Map()
  for (const v of after) { const k = `${v.emp_id}|${String(v.date)}|${norm(v.site_note)}`; (g2.get(k) || g2.set(k, []).get(k)).push(v) }
  let stillRepeated = 0
  for (const g of g2.values()) for (let i = 1; i < g.length; i++) if ((g[i].captured_at - g[i - 1].captured_at) / 1000 <= WINDOW_S) { stillRepeated++; break }
  check(stillRepeated === manual.length, 'no repeated groups remain except the ones left for manual review', `${stillRepeated} remaining, ${manual.length} expected`)

  if (exitCode || !APPLY) {
    await client.query('rollback')
    console.log(exitCode ? '\nSOME CHECKS FAILED — rolled back, nothing changed.' : '\nDRY RUN: rolled back — nothing changed. Re-run with --apply to make these changes.')
  } else {
    await client.query('commit')
    console.log('\nCOMMITTED. Duplicates removed and submitted claims corrected.')
    const allPaths = [...new Set(plan.flatMap(p => p.dropPhotos))]
    if (DELETE_PHOTOS && allPaths.length) {
      const { rows } = await client.query(`select f from unnest($1::text[]) f where travel_photo_is_orphaned(f)`, [allPaths])
      const del = await client.query(`select storage_delete_objects_core('travel-selfies', $1::text[]) ok`, [rows.map(r => r.f)])
      console.log(`Removed ${rows.length} photo file(s) of the deleted copies: ${del.rows[0].ok ? 'ok' : 'storage reported a problem'}`)
    } else {
      console.log(`Photo files of the deleted copies were KEPT (${allPaths.length} file(s)). Remove later with --delete-photos once HR has looked at the receipts.`)
    }
  }
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error('Aborted, rolled back:', e.message)
  exitCode = 1
} finally {
  await client.end()
}
process.exit(exitCode)
