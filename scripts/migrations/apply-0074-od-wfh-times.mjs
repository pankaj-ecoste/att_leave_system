#!/usr/bin/env node
// One-off: apply supabase/migrations/0074_od_wfh_times_and_regularization_both_times.sql (plan.md §60), then PROVE it
// with real employees + sessions inside a transaction that is ALWAYS rolled back (no real row changes).
//
// Safety: BEFORE changing anything it checks that the 4 live functions it replaces are byte-for-byte (ignoring
// whitespace) the ones in the repo migrations 0072 / 0042 / 0059 — so it can never overwrite drifted live code
// (that is how the 2026-09-04 leave-approval incident happened).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/migrations/apply-0074-od-wfh-times.mjs            (preflight + apply + prove)
//   ... node scripts/migrations/apply-0074-od-wfh-times.mjs --preflight   (read-only: only the "live == repo" check)

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations')
const connectionString = process.env.DATABASE_URL
if (!connectionString) { console.error('Set DATABASE_URL (session-pooler string) first.'); process.exit(2) }
const preflightOnly = process.argv.includes('--preflight')
const testOnly = process.argv.includes('--test-only') // migration already applied: skip preflight + apply, just re-run the rolled-back checks
const sql = fs.readFileSync(path.join(MIG, '0074_od_wfh_times_and_regularization_both_times.sql'), 'utf8')

const norm = s => s.replace(/\s+/g, ' ').trim()
// body between the $function$ markers of `create or replace function public.<name>(`
function bodyFromFile(file, name) {
  const text = fs.readFileSync(path.join(MIG, file), 'utf8')
  const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, 'i')
  const m = text.match(re)
  if (!m) throw new Error(`could not find ${name} in ${file}`)
  return norm(m[1])
}
const EXPECT_LIVE = [
  ['apply_leave_core', '0072_leave_range_and_no_overdraw.sql'],
  ['employee_apply_leave_range', '0072_leave_range_and_no_overdraw.sql'],
  ['apply_leave_approval_effects', '0042_regularization_and_partial_leave_status_fix.sql'],
  ['employee_submit_regularization', '0059_regularization_monthly_limit.sql'],
]
const MUST_BE_UNCHANGED = ['manager_decide_leave', 'admin_decide_leave', 'employee_get_leaves', 'manager_get_team_leaves', 'admin_get_leaves',
  'manager_decide_regularization', 'admin_decide_regularization', 'is_valid_employee_token', 'employee_punch']

async function fnHashes(client, names) {
  const { rows } = await client.query(`select p.proname, md5(pg_get_functiondef(p.oid)) as hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[])`, [names])
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
    if (!testOnly) console.log('PRE-FLIGHT: live functions must equal the repo files before anything is changed')
    for (const [fn, file] of testOnly ? [] : EXPECT_LIVE) {
      const { rows } = await client.query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
      check(`live ${fn} == ${file}`, rows.length === 1 && norm(rows[0].prosrc) === bodyFromFile(file, fn), rows.length !== 1 ? `${rows.length} copies live` : '')
    }
    if (failed) { console.log('\nLive code has drifted from the repo — STOP, nothing was changed. Read the live functions with pg_get_functiondef and rebuild 0074 from them.'); process.exit(1) }
    if (preflightOnly) { console.log('\nPreflight OK (read-only, nothing changed).'); process.exit(0) }

    const { rows: pend } = await client.query(`select count(*)::int as n from leave_applications where leave_type in ('On Duty','Work From Home') and status in ('Pending','Manager Approved')`)
    console.log(`\nOD/WFH requests pending right now (they have no times; they stay approvable as before): ${pend[0].n}`)

    const before = await fnHashes(client, MUST_BE_UNCHANGED)
    if (!testOnly) await client.query(sql)
    console.log(testOnly ? '\n(--test-only: migration was already applied, only re-checking)\n' : '\nMigration 0074 applied.\n')
    const after = await fnHashes(client, MUST_BE_UNCHANGED)
    for (const n of MUST_BE_UNCHANGED) check(`${n} untouched`, before[n] === after[n])

    const { rows: cols } = await client.query(`select column_name from information_schema.columns where table_name='leave_applications' and column_name in ('requested_in','requested_out')`)
    check('leave_applications has requested_in + requested_out', cols.length === 2)
    for (const fn of ['apply_leave_core', 'apply_leave_approval_effects']) {
      const { rows } = await client.query(`select has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
      check(`${fn} is private (anon cannot call it)`, rows.length === 1 && !rows[0].anon_can)
    }
    for (const fn of ['employee_apply_leave_range', 'employee_submit_regularization']) {
      const { rows } = await client.query(`select has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
      check(`${fn}: exactly one copy, callable by the app`, rows.length === 1 && rows[0].anon_can)
    }

    console.log('\nBehaviour test (rolled back afterwards):')
    const { rows: team } = await client.query(`
      select m.id as mgr, (array_agg(e.id order by e.name))[1] as a, (array_agg(e.id order by e.name))[2] as b, (array_agg(e.id order by e.name))[3] as c
      from employees m join employees e on e.manager_emp_id = m.id
      where e.active and e.deleted_at is null and m.active and m.deleted_at is null
        and e.company is distinct from 'Asma + Production Plant'
        and not exists (select 1 from leave_applications l where l.emp_id = e.id and l.date = (now() at time zone 'Asia/Kolkata')::date)
        and not exists (select 1 from attendance a where a.emp_id = e.id and a.date = (now() at time zone 'Asia/Kolkata')::date)
      group by m.id having count(*) >= 3 limit 1`)
    if (!team.length) throw new Error('Need a manager with 3 active reports who have no record today to test with')
    const { mgr, a: A, b: B, c: C } = team[0]
    const today = (await client.query(`select (now() at time zone 'Asia/Kolkata')::date::text as d`)).rows[0].d
    const tomorrow = (await client.query(`select ((now() at time zone 'Asia/Kolkata')::date + 1)::text as d`)).rows[0].d

    const realBefore = {
      leaves: (await client.query('select count(*)::int n from leave_applications')).rows[0].n,
      att: (await client.query('select count(*)::int n from attendance')).rows[0].n,
      regs: (await client.query('select count(*)::int n from regularization_requests')).rows[0].n,
      audit: (await client.query('select count(*)::int n from audit_logs')).rows[0].n,
    }

    await client.query('begin')
    try {
      const sess = async id => (await client.query(`insert into employee_sessions (emp_id) values ($1) returning token`, [id])).rows[0].token
      const tokA = await sess(A), tokB = await sess(B), tokC = await sess(C), tokM = await sess(mgr)
      const names = Object.fromEntries((await client.query(`select id, name, company from employees where id = any($1::uuid[])`, [[A, B, C]])).rows.map(r => [r.id, r]))
      const safe = async (fn) => {
        await client.query('savepoint s')
        try { const r = await fn(); await client.query('release savepoint s'); return { ok: true, r } }
        catch (e) { await client.query('rollback to savepoint s'); return { ok: false, msg: e.message } }
      }
      const apply = (tok, id, over) => safe(async () => (await client.query(
        `select * from employee_apply_leave_range($1, $2, $3::jsonb)`,
        [tok, id, JSON.stringify({ emp_name: names[id].name, company: names[id].company, reason: 'test', location: 'test place', day_part: 'full', date: today, ...over })])).rows)
      const regsBeforeA = (await client.query(`select count(*)::int n from regularization_requests where emp_id=$1`, [A])).rows[0].n
      const att = async (id, d = today) => (await client.query(`select * from attendance where emp_id=$1 and date=$2`, [id, d])).rows[0]

      // ---- applying
      let r = await apply(tokA, A, { leave_type: 'On Duty' })
      check('On Duty WITHOUT times is refused', !r.ok && /in-time and out-time/.test(r.msg), r.msg)
      r = await apply(tokA, A, { leave_type: 'On Duty', date: tomorrow, requested_in: '09:00', requested_out: '18:00' })
      check('On Duty for TOMORROW is refused (today only)', !r.ok && /only be applied for today/.test(r.msg), r.msg)
      r = await apply(tokA, A, { leave_type: 'Work From Home', requested_in: '18:00', requested_out: '09:00' })
      check('out-time before in-time is refused', !r.ok && /Out-time must be after in-time/.test(r.msg), r.msg)
      r = await apply(tokA, A, { leave_type: 'Work From Home', end_date: tomorrow, requested_in: '09:00', requested_out: '18:00' })
      check('a multi-day WFH range is refused', !r.ok && /one day at a time/.test(r.msg), r.msg)
      r = await apply(tokA, A, { leave_type: 'On Duty', requested_in: '09:30', requested_out: '18:30' })
      check('On Duty today WITH times is accepted as Pending, times stored', r.ok && r.r.length === 1 && r.r[0].status === 'Pending' && r.r[0].requested_in === '09:30:00' && r.r[0].requested_out === '18:30:00', r.msg || '')
      const odA = r.ok ? r.r[0] : null
      check('a PENDING request does not touch attendance', !(await att(A)))

      // ---- approval (by the manager, like the real flow)
      await client.query(`select manager_decide_leave($1, $2, $3, 'Approved')`, [tokM, mgr, odA.id])
      const rowA = await att(A)
      check('approved On Duty -> status "On Duty", on_duty flag, times 09:30-18:30 written', rowA && rowA.status === 'On Duty' && rowA.on_duty === true && rowA.in_time === '09:30:00' && rowA.out_time === '18:30:00', JSON.stringify(rowA && [rowA.status, rowA.in_time, rowA.out_time]))

      // ---- WFH when the person had already punched in: approved times replace, real punch kept, audit written
      await client.query(`insert into attendance (emp_id, date, in_time, status, source, app_in_time) values ($1, $2, '09:00', 'Punched In', 'app', '09:00')`, [B, today])
      r = await apply(tokB, B, { leave_type: 'Work From Home', requested_in: '10:00', requested_out: '18:00' })
      check('WFH today (already punched in) is accepted', r.ok, r.msg || '')
      await client.query(`select manager_decide_leave($1, $2, $3, 'Approved')`, [tokM, mgr, r.r[0].id])
      const rowB = await att(B)
      check('approved WFH replaces punch times with 10:00-18:00, status WFH', rowB.in_time === '10:00:00' && rowB.out_time === '18:00:00' && rowB.status === 'WFH' && rowB.wfh === true, JSON.stringify([rowB.status, rowB.in_time, rowB.out_time]))
      check('the real punch survives in app_in_time', rowB.app_in_time === '09:00:00', String(rowB.app_in_time))
      const { rows: aud } = await client.query(`select detail from audit_logs where action='LEAVE_TIMES_REPLACED' and ts > now() - interval '1 minute'`)
      check('LEAVE_TIMES_REPLACED audit row written', aud.length === 1 && /09:00–--/.test(aud[0].detail) && /10:00–18:00/.test(aud[0].detail), aud[0]?.detail || 'none')

      // ---- a REJECTED one changes nothing
      r = await apply(tokC, C, { leave_type: 'On Duty', requested_in: '10:00', requested_out: '17:00' })
      await client.query(`select manager_decide_leave($1, $2, $3, 'Rejected')`, [tokM, mgr, r.r[0].id])
      check('a REJECTED request leaves attendance untouched', !(await att(C)))

      // ---- OLD pending request with no times (applied before this change) still approves exactly as before
      await client.query(`delete from leave_applications where id = $1`, [r.r[0].id])
      const { rows: old } = await client.query(`insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, status) values ($1,$2,$3,'On Duty',$4,'full','old','x','Pending') returning id`, [C, names[C].name, names[C].company, today])
      await client.query(`select manager_decide_leave($1, $2, $3, 'Approved')`, [tokM, mgr, old[0].id])
      const rowC = await att(C)
      check('an OLD pending On Duty (no times) approves as before: On Duty, no times', rowC && rowC.status === 'On Duty' && rowC.in_time === null && rowC.out_time === null, JSON.stringify(rowC && [rowC.status, rowC.in_time]))

      // ---- other leave types are unaffected
      await client.query(`delete from attendance where emp_id = $1 and date = $2`, [A, today]); await client.query(`delete from leave_applications where emp_id = $1`, [A])
      r = await apply(tokA, A, { leave_type: 'LOP' })
      check('LOP today needs no times and stores none', r.ok && r.r[0].requested_in === null && r.r[0].requested_out === null, r.msg || '')
      r = await apply(tokA, A, { leave_type: 'LOP', date: tomorrow, end_date: tomorrow })
      check('LOP for another day still works', r.ok, r.msg || '')

      // ---- regularization: both times
      const reg = (tok, id, i, o, d) => safe(async () => (await client.query(`select (employee_submit_regularization($1,$2,$3::date,$4,$5,'test')).id as id`, [tok, id, d, i, o])).rows[0])
      let g = await reg(tokA, A, '09:00', null, '2026-10-01')
      check('regularization with only an in-time is refused', !g.ok && /both your in-time and your out-time/.test(g.msg), g.msg)
      g = await reg(tokA, A, null, '18:00', '2026-10-01')
      check('regularization with only an out-time is refused', !g.ok && /both/.test(g.msg), g.msg)
      g = await reg(tokA, A, '09:00', '18:00', '2026-10-01')
      check('regularization with both times is accepted', g.ok, g.msg || '')
      const used = (await client.query(`select count(*)::int n from regularization_requests where emp_id=$1`, [A])).rows[0].n
      // A may already have real requests; only the ONE accepted request in this test may have been added.
      check('refused requests did not use up the monthly allowance (only the 1 accepted one was added)', used === regsBeforeA + 1, `rows: ${regsBeforeA} -> ${used}`)
    } finally {
      await client.query('rollback')
    }
    const realAfter = {
      leaves: (await client.query('select count(*)::int n from leave_applications')).rows[0].n,
      att: (await client.query('select count(*)::int n from attendance')).rows[0].n,
      regs: (await client.query('select count(*)::int n from regularization_requests')).rows[0].n,
      audit: (await client.query('select count(*)::int n from audit_logs')).rows[0].n,
    }
    check('test rolled back: leave / attendance / regularization / audit row counts unchanged', JSON.stringify(realBefore) === JSON.stringify(realAfter), `${JSON.stringify(realBefore)} -> ${JSON.stringify(realAfter)}`)
  } finally {
    await client.end()
  }
  console.log(failed ? `\n${failed} CHECK(S) FAILED — do NOT push the front-end.` : '\nAll checks passed. Safe to push the matching front-end.')
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
