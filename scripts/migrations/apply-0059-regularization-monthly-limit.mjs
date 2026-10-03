#!/usr/bin/env node
// One-off: apply supabase/migrations/0059_regularization_monthly_limit.sql (plan.md §39),
// then PROVE the 5-per-month limit with test employees and sessions inside a transaction
// that is ALWAYS rolled back — no real request, session or employee row is changed.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0059-regularization-monthly-limit.mjs

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0059_regularization_monthly_limit.sql'), 'utf8')

const MUST_BE_UNCHANGED = ['employee_get_regularizations', 'manager_decide_regularization', 'admin_decide_regularization', 'manager_get_team_regularizations', 'admin_get_regularizations', 'is_valid_employee_token']

async function fnHashes(client, names) {
  const { rows } = await client.query(`
    select p.proname, md5(pg_get_functiondef(p.oid)) as hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`, [names])
  return Object.fromEntries(rows.map(r => [r.proname, r.hash]))
}

let failed = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: live } = await client.query(`select count(*)::int as n from regularization_requests where (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')`)
    const { rows: over } = await client.query(`
      select e.name, count(*)::int as n from regularization_requests r join employees e on e.id = r.emp_id
      where (r.created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')
      group by e.name having count(*) >= 5 order by n desc`)
    console.log(`Requests filed so far this month: ${live[0].n}. Employees ALREADY at/over 5 this month (will be blocked from filing more until the 1st):`, over.length ? over : 'none')

    const before = await fnHashes(client, MUST_BE_UNCHANGED)
    await client.query(sql)
    console.log('\nMigration 0059 applied.\n')
    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    for (const n of MUST_BE_UNCHANGED) check(`${n} untouched`, before[n] === after[n])

    const { rows: fns } = await client.query(`select pg_get_function_identity_arguments(p.oid) as args, has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='employee_submit_regularization'`)
    check('exactly one employee_submit_regularization, callable by anon, same 6 arguments', fns.length === 1 && fns[0].anon_can && fns[0].args.split(',').length === 6, JSON.stringify(fns))

    console.log('\nBehaviour test (rolled back afterwards):')
    const { rows: emps } = await client.query(`
      select e.id from employees e
      where e.active and not exists (select 1 from regularization_requests r where r.emp_id = e.id and r.created_at > now() - interval '45 days')
      limit 2`)
    if (emps.length < 2) throw new Error('Need two active employees with no recent requests to test with')
    const [A, B] = [emps[0].id, emps[1].id]

    await client.query('begin')
    try {
      const sess = async id => (await client.query(`insert into employee_sessions (emp_id) values ($1) returning token`, [id])).rows[0].token
      const tokA = await sess(A), tokB = await sess(B)
      const submit = async (id, tok, d) => {
        try {
          const { rows } = await client.query(`select (employee_submit_regularization($1, $2, $3::date, '09:00', '18:00', 'test')).id as id`, [tok, id, d])
          return { ok: true, id: rows[0].id }
        } catch (e) { return { ok: false, msg: e.message } }
      }
      // savepoint so a raised exception doesn't poison the outer transaction
      const safe = async (id, tok, d) => {
        await client.query('savepoint s')
        const r = await submit(id, tok, d)
        await client.query(r.ok ? 'release savepoint s' : 'rollback to savepoint s')
        return r
      }

      const first = []
      for (let i = 1; i <= 5; i++) first.push(await safe(A, tokA, `2026-10-0${i}`))
      check('requests 1-5 are all accepted', first.every(r => r.ok), first.map(r => r.ok).join(','))

      const sixth = await safe(A, tokA, '2026-10-06')
      check('the 6th request is rejected, with a clear message', !sixth.ok && /already used all 5/.test(sixth.msg), sixth.msg)

      // Rejected requests still use up the allowance.
      await client.query(`update regularization_requests set status = 'Rejected' where id = $1`, [first[0].id])
      const afterReject = await safe(A, tokA, '2026-10-07')
      check('a REJECTED request still counts (still blocked at 5)', !afterReject.ok)

      const other = await safe(B, tokB, '2026-10-01')
      check('a different employee is unaffected by A hitting the limit', other.ok, other.msg || '')

      // Last month's requests don't count: age all of A's requests into last month.
      await client.query(`update regularization_requests set created_at = date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '2 days' where emp_id = $1`, [A])
      const fresh = await safe(A, tokA, '2026-10-08')
      check('requests filed LAST month do not count — allowance is back', fresh.ok, fresh.msg || '')

      const bad = await safe(A, '00000000-0000-0000-0000-000000000000', '2026-10-09')
      check('an invalid session is still refused first', !bad.ok && /Invalid session/.test(bad.msg), bad.msg)
    } finally {
      await client.query('rollback')
    }
    const { rows: after2 } = await client.query(`select count(*)::int as n from regularization_requests where (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')`)
    check('test rolled back (this month\'s real request count unchanged)', after2[0].n === live[0].n, `${live[0].n} -> ${after2[0].n}`)
  } finally {
    await client.end()
  }
  console.log(failed ? `\n${failed} CHECK(S) FAILED — do not push the front-end.` : '\nAll checks passed. Safe to push the matching front-end.')
  process.exit(failed ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
