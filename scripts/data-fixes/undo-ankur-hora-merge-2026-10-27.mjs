#!/usr/bin/env node
// HR changed their mind: keep TWO Ankur Hora entries (#1213 Asma, #1254 Metamask) so he picks the company tile
// at login and sees only that company's team. This reverses merge-ankur-hora-2026-10-27.mjs:
//   * #1254 is brought back (deleted_at = null, active = true)
//   * Metamask-company staff who report to #1213 go back to #1254 (that is exactly the 9 that were moved)
//   * leave decisions on Metamask staff's leaves that the merge re-pointed to #1213 go back to #1254
//   * #1213's email goes back to blank (the merge had copied info@ecoste.in onto it; #1254 still has it)
// Guards: it aborts unless exactly 9 reports and 23 decisions are moved back — the numbers the merge reported.
//
// DEFAULT = DRY RUN (rolled back). --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/undo-ankur-hora-merge-2026-10-27.mjs [--apply]
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const ASMA = '1213', META = '1254', METAMASK = 'Metamask Design Solutions LLP'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  const { rows: [a] } = await client.query(`select id, name, email from employees where emp_num = $1 and deleted_at is null`, [ASMA])
  const { rows: [m] } = await client.query(`select id, name, email, deleted_at from employees where emp_num = $1`, [META])
  if (!a) throw new Error('#1213 is not live')
  if (!m || !m.deleted_at) throw new Error('#1254 is missing or already live — nothing to undo')

  await client.query(`update employees set deleted_at = null, active = true, updated_at = now() where id = $1`, [m.id])
  const reports = await client.query(`update employees set manager_emp_id = $1, manager = $2, updated_at = now() where manager_emp_id = $3 and company = $4 and deleted_at is null`, [m.id, m.name, a.id, METAMASK])
  const decided = await client.query(`update leave_applications l set manager_decided_by = $1 from employees e where e.id = l.emp_id and e.company = $2 and l.manager_decided_by = $3`, [m.id, METAMASK, a.id])
  await client.query(`update employees set email = null, updated_at = now() where id = $1 and email = $2`, [a.id, m.email])
  await client.query(`select log_audit('EMPLOYEE_RESTORE', $1, 'admin')`, [`${m.name.trim()} #${META} restored (two Ankur Hora entries kept on purpose)`])

  console.log(`reports moved back to #${META}: ${reports.rowCount}; leave decisions moved back: ${decided.rowCount}`)
  if (reports.rowCount !== 9 || decided.rowCount !== 23) throw new Error('Counts differ from what the merge moved (9 / 23) — rolled back')
  const { rows } = await client.query(`select e.emp_num, e.company, e.email, (select count(*)::int from employees r where r.manager_emp_id = e.id and r.deleted_at is null) reports from employees e where e.name ilike 'Ankur Hora%' and e.deleted_at is null order by e.emp_num`)
  console.table(rows)
  if (rows.length !== 2 || rows[0].reports !== 21 || rows[1].reports !== 9) throw new Error('Expected two live entries with 21 and 9 reports — rolled back')

  if (APPLY) { await client.query('commit'); console.log('COMMITTED.') }
  else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
