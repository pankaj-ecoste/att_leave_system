#!/usr/bin/env node
// Permanently remove the "Lamora Buildtech Pvt Ltd" company's employee(s) and every row that hangs off them.
//
// Safety:
//   * DEFAULT = DRY RUN: the delete runs inside a transaction that is rolled back; the plan is printed.
//   * --apply commits. A JSON backup of the employee row(s) and all dependent rows is written to
//     C:\ecoste\backups BEFORE the delete.
//   * Dependent tables are found from the database's own foreign keys, so none is missed. If a foreign
//     key does NOT cascade and blocks the delete, the script stops and says which table.
//   * Files in Supabase Storage (e.g. travel photos) are not touched.
//
// Usage: DATABASE_URL=... node scripts/data-fixes/remove-lamora-company-2026-10-27.mjs [--apply]
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const COMPANY = 'Lamora Buildtech Pvt Ltd'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: emps } = await client.query(
  `select id, emp_num, name, company, active, deleted_at from employees where company = $1 order by name`, [COMPANY])
console.log(`Employees in "${COMPANY}": ${emps.length}`)
console.table(emps)
if (!emps.length) { console.log('Nothing to remove.'); await client.end(); process.exit(0) }
const ids = emps.map(e => e.id)

// every table with a foreign key pointing at employees(id), and what the FK does on delete
const { rows: fks } = await client.query(`
  select c.conrelid::regclass::text as tbl, a.attname as col,
         case c.confdeltype when 'c' then 'CASCADE' when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                            when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.confrelid = 'public.employees'::regclass
  order by 1`)

const backup = { company: COMPANY, takenAt: new Date().toISOString(), employees: emps, dependents: {} }
const plan = []
for (const fk of fks) {
  const { rows } = await client.query(`select * from ${fk.tbl} where ${fk.col} = any($1)`, [ids])
  backup.dependents[`${fk.tbl}.${fk.col}`] = rows
  plan.push({ table: fk.tbl, column: fk.col, on_delete: fk.on_delete, rows: rows.length })
}
console.table(plan)

if (APPLY) {
  fs.mkdirSync('C:\\ecoste\\backups', { recursive: true })
  const file = `C:\\ecoste\\backups\\lamora-before-removal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
  fs.writeFileSync(file, JSON.stringify(backup, null, 2))
  console.log('Backup written:', file)
}

try {
  await client.query('begin')
  const r = await client.query(`delete from employees where id = any($1)`, [ids])
  console.log(`Deleted employee rows: ${r.rowCount}`)
  if (APPLY) { await client.query('commit'); console.log('COMMITTED.') }
  else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply to delete for real.') }
} catch (e) {
  await client.query('rollback')
  console.error('Delete FAILED and was rolled back:', e.message)
  process.exitCode = 1
}
await client.end()
