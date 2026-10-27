#!/usr/bin/env node
// PERMANENTLY erase every employee that is already soft-removed (deleted_at is not null) together with all
// rows that belong to them (attendance, leave, balances, travel, sessions, ... — found from the database's own
// foreign keys, so none is missed). After this only the live staff remain; anyone needed later is added from scratch.
//
// Safety:
//   * DEFAULT = DRY RUN: the delete runs inside a transaction that is rolled back; the plan is printed.
//   * --apply writes a FULL JSON backup first (complete employee rows + every dependent row) to C:\ecoste\backups,
//     then deletes and commits.
//   * Refuses to run if it would touch a live employee, or if the live head-count is not what it should be.
//   * Photos / files in Supabase Storage are NOT deleted by this script (listed in the dry run so they can be
//     cleaned separately).
//
// Usage: DATABASE_URL=... node scripts/data-fixes/purge-removed-staff-2026-10-27.mjs [--apply] [--expect-live 83]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const ei = process.argv.indexOf('--expect-live')
const EXPECT_LIVE = ei > 0 ? Number(process.argv[ei + 1]) : 83

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows: [live] } = await client.query(`select count(*)::int n from employees where deleted_at is null`)
  if (live.n !== EXPECT_LIVE) throw new Error(`Live head-count is ${live.n}, expected ${EXPECT_LIVE} — refusing`)

  const { rows: gone } = await client.query(`select * from employees where deleted_at is not null order by emp_num`)
  console.log(`Live staff (stay): ${live.n}   |   removed staff to ERASE: ${gone.length}`)
  console.table(gone.map(e => ({ num: e.emp_num, name: String(e.name).trim(), company: String(e.company).split(' ')[0], removed: String(e.deleted_at).slice(0, 15) })))
  const ids = gone.map(e => e.id)

  const { rows: fks } = await client.query(`
    select c.conrelid::regclass::text as tbl, a.attname as col,
           case c.confdeltype when 'c' then 'CASCADE' when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                              when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.employees'::regclass order by 1`)

  const backup = { takenAt: new Date().toISOString(), employees: gone, dependents: {} }
  const plan = []
  for (const fk of fks) {
    const isSelf = fk.tbl === 'employees'
    // for the self-reference (manager_emp_id) only rows of LIVE staff matter: they are set to NULL, not deleted
    const { rows } = await client.query(`select * from ${fk.tbl} where ${fk.col} = any($1)${isSelf ? ' and deleted_at is null' : ''}`, [ids])
    backup.dependents[`${fk.tbl}.${fk.col}`] = rows
    if (rows.length || fk.on_delete !== 'CASCADE') plan.push({ table: fk.tbl, column: fk.col, on_delete: fk.on_delete, rows: rows.length })
  }
  console.log('\nRows that go with them (tables with 0 rows not shown):')
  console.table(plan)
  const blockers = plan.filter(p => (p.on_delete === 'NO ACTION' || p.on_delete === 'RESTRICT') && p.rows > 0)
  if (blockers.length) throw new Error(`These tables block the delete: ${blockers.map(b => b.table).join(', ')}`)

  // files in Storage that belong to them (not deleted here)
  const paths = []
  for (const [key, rows] of Object.entries(backup.dependents)) for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (/(photo|path|selfie|document)/i.test(k) && typeof v === 'string' && v.includes('/')) paths.push(`${key.split('.')[0]}.${k}`)
  }
  const fileCounts = paths.reduce((m, p) => ((m[p] = (m[p] || 0) + 1), m), {})
  console.log('Storage files referenced (NOT deleted by this script):', Object.keys(fileCounts).length ? fileCounts : 'none')

  if (APPLY) {
    fs.mkdirSync('C:\\ecoste\\backups', { recursive: true })
    const file = `C:\\ecoste\\backups\\removed-staff-full-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
    fs.writeFileSync(file, JSON.stringify(backup, null, 2))
    console.log('\nFULL backup written:', file)
  }

  await client.query('begin')
  const r = await client.query(`delete from employees where id = any($1) and deleted_at is not null`, [ids])
  const { rows: [after] } = await client.query(`select count(*)::int n, count(*) filter (where deleted_at is not null)::int removed from employees`)
  console.log(`\ndeleted employee rows: ${r.rowCount}; employees table now: ${after.n} rows, ${after.removed} removed-marked`)
  if (r.rowCount !== gone.length || after.n !== EXPECT_LIVE || after.removed !== 0) throw new Error('Unexpected result — rolled back')
  if (APPLY) { await client.query('commit'); console.log('COMMITTED. Only the live staff remain.') }
  else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
