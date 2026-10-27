#!/usr/bin/env node
// One field: Sameer Ansari (#1253) department "Production- MetaMask" -> "Production" (HR's head-count sheet).
// Refuses unless the current value is exactly what was seen. DEFAULT = DRY RUN; --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/fix-sameer-ansari-department-2026-10-27.mjs [--apply]
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  const r = await client.query(`update employees set department = 'Production', updated_at = now() where emp_num = '1253' and deleted_at is null and department = 'Production- MetaMask' returning name, department`)
  if (r.rowCount !== 1) throw new Error('Sameer Ansari does not have the expected current department — nothing changed')
  const { rows } = await client.query(`select 1 from dropdown_options where kind = 'department' and value = 'Production'`)
  if (rows.length !== 1) throw new Error('"Production" is not in the Department list')
  console.log(`${r.rows[0].name.trim()}: department -> ${r.rows[0].department}`)
  if (APPLY) { await client.query('commit'); console.log('COMMITTED.') } else { await client.query('rollback'); console.log('DRY RUN — rolled back.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
