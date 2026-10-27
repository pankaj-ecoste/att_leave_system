#!/usr/bin/env node
// HR request: in the Business Unit dropdown, "Ecoste" becomes "Field".
// Renames the list value in place (same row). Refuses unless NO employee currently holds "Ecoste" (after the
// head-count-sheet match nobody does) and "Field" is not already in the list — so no employee is left on a
// value that is not in the list.
// DEFAULT = DRY RUN (rolled back); --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/rename-business-unit-ecoste-to-field-2026-10-27.mjs [--apply]
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  const { rows: [used] } = await client.query(`select count(*)::int n from employees where business_unit = 'Ecoste'`)
  if (used.n !== 0) throw new Error(`${used.n} employee(s) still have Business Unit "Ecoste" — nothing changed`)
  const { rows: clash } = await client.query(`select 1 from dropdown_options where kind = 'business_unit' and lower(value) = 'field'`)
  if (clash.length) throw new Error('"Field" is already in the Business Unit list — nothing changed')
  const r = await client.query(`update dropdown_options set value = 'Field' where kind = 'business_unit' and value = 'Ecoste' returning id`)
  if (r.rowCount !== 1) throw new Error('"Ecoste" is not in the Business Unit list')
  await client.query(`select log_audit('DROPDOWN_RENAME', 'business_unit: Ecoste -> Field', 'admin')`)
  const { rows } = await client.query(`select value from dropdown_options where kind = 'business_unit' order by lower(value)`)
  console.log('Business Unit list now:', rows.map(x => x.value).join(' | '))
  if (APPLY) { await client.query('commit'); console.log('COMMITTED.') } else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
