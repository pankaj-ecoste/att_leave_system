#!/usr/bin/env node
// Soft-remove the 45 staff who are not in HR's final sheet (2026-10-27) — the same thing the app's Delete
// button does (admin_delete_employee, migration 0017): deleted_at = now(), active = false, audit-logged.
// Their attendance / leave / travel history stays in the database, so this can be undone by clearing
// deleted_at and setting active back to true.
//
// KEPT on purpose: BOTH "Ankur Hora" entries (#1213 Asma and #1254 Metamask) — they are not in the sheet's
// 80 rows but HR asked to keep them. The script refuses to run if either is in the removal list.
//
// DEFAULT = DRY RUN (transaction rolled back). --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/remove-staff-not-in-hr-sheet-2026-10-27.mjs [--apply]
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')

const REMOVE = [
  '1114', '1115', '1116', '1118', '1127', '1139', '1162', '1169', '1179', '1188', '1189', '1191', '1193', '1194', '1196',
  '1197', '1200', '1201', '1202', '1203', '1208', '1209', '1212', '1214', '1217', '1218', '1220', '1223', '1226', '1228',
  '1229', '1231', '1232', '1234', '1235', '1236', '1237', '1238', '1239', '1240', '1241', '1242', '1243', '1253', '1258',
]
const MUST_KEEP = ['1213', '1254'] // Ankur Hora (Asma) and Ankur Hora (Metamask)

if (new Set(REMOVE).size !== REMOVE.length || REMOVE.length !== 45) throw new Error('Removal list is not 45 distinct numbers')
if (REMOVE.some(n => MUST_KEEP.includes(n))) throw new Error('Removal list contains an Ankur Hora — refusing')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  const { rows: before } = await client.query(`select count(*)::int n from employees where deleted_at is null`)
  const { rows: targets } = await client.query(`select id, emp_num, name from employees where emp_num = any($1) and deleted_at is null order by emp_num`, [REMOVE])
  if (targets.length !== REMOVE.length) throw new Error(`Expected ${REMOVE.length} live employees, found ${targets.length} — nothing changed`)

  for (const t of targets) {
    await client.query(`update employees set deleted_at = now(), active = false, updated_at = now() where id = $1`, [t.id])
    await client.query(`select log_audit('EMPLOYEE_DELETE', $1, 'admin')`, [t.name])
  }

  const { rows: after } = await client.query(`select count(*)::int n from employees where deleted_at is null`)
  const { rows: ankur } = await client.query(`select emp_num, company from employees where name ilike 'Ankur Hora%' and deleted_at is null order by emp_num`)
  console.log(`live staff: ${before[0].n} -> ${after[0].n}`)
  console.log('Ankur Hora still live:', ankur.map(r => `#${r.emp_num} ${r.company}`).join(' | '))
  if (after[0].n !== before[0].n - REMOVE.length) throw new Error('Unexpected live count — rolled back')
  if (ankur.length !== 2) throw new Error('Both Ankur Hora entries must remain — rolled back')

  if (APPLY) { await client.query('commit'); console.log('COMMITTED. 45 staff removed (soft).') }
  else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
