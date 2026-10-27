#!/usr/bin/env node
// Ankur Hora had two entries (#1213 Asma, #1254 Metamask) so he could be manager of both companies' staff.
// Every manager function in the database works across companies (they key off manager_emp_id, never the
// company), so one entry is enough. This keeps #1213 and folds #1254 into it:
//   * everyone whose manager was #1254 now reports to #1213 (same name, so the text stays "Ankur Hora")
//   * leave decisions #1254 made are re-pointed to #1213 so history reads correctly
//   * #1213 gets #1254's email if it has none
//   * #1254 is soft-removed (deleted_at + active=false, audit-logged) — his 1 attendance day and 3 leave-balance
//     rows stay in the database
//
// DEFAULT = DRY RUN (rolled back). --apply commits.
// Usage: DATABASE_URL=... node scripts/data-fixes/merge-ankur-hora-2026-10-27.mjs [--apply]
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const KEEP = '1213', DROP = '1254'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  const { rows: [keep] } = await client.query(`select id, name, email, company from employees where emp_num = $1 and deleted_at is null`, [KEEP])
  const { rows: [drop] } = await client.query(`select id, name, email, company from employees where emp_num = $1 and deleted_at is null`, [DROP])
  if (!keep || !drop) throw new Error('One of the two entries is missing or already removed')
  if (keep.name.trim() !== drop.name.trim()) throw new Error('Names differ — not the same person, refusing')

  const reports = await client.query(`update employees set manager_emp_id = $1, manager = $2, updated_at = now() where manager_emp_id = $3`, [keep.id, keep.name, drop.id])
  const decided = await client.query(`update leave_applications set manager_decided_by = $1 where manager_decided_by = $2`, [keep.id, drop.id])
  if (!keep.email && drop.email) await client.query(`update employees set email = $1 where id = $2`, [drop.email, keep.id])
  await client.query(`update employees set deleted_at = now(), active = false, updated_at = now() where id = $1`, [drop.id])
  await client.query(`select log_audit('EMPLOYEE_DELETE', $1, 'admin')`, [`${drop.name.trim()} (duplicate #${DROP} merged into #${KEEP})`])

  const { rows: [n] } = await client.query(`select count(*)::int c from employees where manager_emp_id = $1 and deleted_at is null`, [keep.id])
  const { rows: left } = await client.query(`select count(*)::int c from employees where manager_emp_id = $1`, [drop.id])
  const { rows: live } = await client.query(`select emp_num, company, email from employees where name ilike 'Ankur Hora%' and deleted_at is null`)
  console.log(`reports moved: ${reports.rowCount}; leave decisions re-pointed: ${decided.rowCount}`)
  console.log(`#${KEEP} now has ${n.c} direct reports; #${DROP} has ${left[0].c}`)
  console.log('Ankur Hora live entries:', live.map(r => `#${r.emp_num} ${r.company} ${r.email || '(no email)'}`).join(' | '))
  if (live.length !== 1 || live[0].emp_num !== KEEP || left[0].c !== 0) throw new Error('Unexpected result — rolled back')

  if (APPLY) { await client.query('commit'); console.log('COMMITTED.') }
  else { await client.query('rollback'); console.log('DRY RUN — rolled back, nothing changed. Re-run with --apply.') }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
