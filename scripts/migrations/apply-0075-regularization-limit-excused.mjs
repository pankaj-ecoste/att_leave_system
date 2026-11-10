#!/usr/bin/env node
// One-off: apply 0075 (plan.md §61) and give ONE employee a fresh 5-request allowance this month by marking
// their requests filed this month as "excused" (limit_excused_at). Nothing is deleted.
// Safety: first proves the live employee_submit_regularization == the 0074 file. Behaviour is proved in a
// rolled-back transaction. Only the named employee's requests are touched (checked by before/after counts).
//
// Usage: DATABASE_URL=... node scripts/migrations/apply-0075-regularization-limit-excused.mjs "Ashish Singh"

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations')
const connectionString = process.env.DATABASE_URL
const who = process.argv[2]
if (!connectionString || !who) { console.error('Set DATABASE_URL and pass the exact employee name.'); process.exit(2) }
const sql = fs.readFileSync(path.join(MIG, '0075_regularization_limit_excused.sql'), 'utf8')
const norm = s => s.replace(/\s+/g, ' ').trim()
const bodyFromFile = (file, name) => {
  const m = fs.readFileSync(path.join(MIG, file), 'utf8').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, 'i'))
  if (!m) throw new Error(`no ${name} in ${file}`)
  return norm(m[1])
}
let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows: live } = await client.query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='employee_submit_regularization'`)
  check('live employee_submit_regularization == 0074 file', live.length === 1 && norm(live[0].prosrc) === bodyFromFile('0074_od_wfh_times_and_regularization_both_times.sql', 'employee_submit_regularization'))
  if (failed) { console.log('Live code differs from the repo — nothing changed.'); process.exit(1) }

  const { rows: emps } = await client.query(`select id, name from employees where name = $1 and deleted_at is null`, [who])
  if (emps.length !== 1) throw new Error(`expected exactly one employee named "${who}", found ${emps.length}`)
  const E = emps[0].id
  const monthStart = `date_trunc('month', now() at time zone 'Asia/Kolkata')`
  const counted = id => client.query(`select count(*)::int n from regularization_requests where emp_id=$1 and limit_excused_at is null and (created_at at time zone 'Asia/Kolkata') >= ${monthStart}`, [id]).then(r => r.rows[0].n)
  const othersCounted = () => client.query(`select coalesce(sum(1),0)::int n from regularization_requests where emp_id <> $1 and limit_excused_at is null and (created_at at time zone 'Asia/Kolkata') >= ${monthStart}`, [E]).then(r => r.rows[0].n)

  // the new column must exist before anything can count with it (nobody is excused yet, so these are the "before" numbers)
  await client.query(sql)
  console.log('Migration 0075 applied.')
  const used0 = await counted(E), others0 = await othersCounted()
  console.log(`${who}: requests counting this month BEFORE the reset = ${used0}. Everyone else counting = ${others0}`)

  const { rowCount } = await client.query(`update regularization_requests set limit_excused_at = now() where emp_id=$1 and limit_excused_at is null and (created_at at time zone 'Asia/Kolkata') >= ${monthStart}`, [E])
  await client.query(`select log_audit('REGULARIZATION_LIMIT_RESET', $1, 'system')`, [`${who} — ${rowCount} correction request(s) filed this month excused from the 5-a-month limit (fresh allowance of 5)`])
  console.log(`Excused ${rowCount} request(s) for ${who}.`)

  check(`${who} now counts 0 this month (so all 5 are available)`, (await counted(E)) === 0)
  check('nobody else changed', (await othersCounted()) === others0, `${others0} -> ${await othersCounted()}`)
  const { rows: kept } = await client.query(`select count(*)::int n from regularization_requests where emp_id=$1`, [E])
  console.log(`(${kept[0].n} requests still on record for ${who} — none deleted)`)

  // behaviour: in a rolled-back transaction the employee can file exactly 5, the 6th is refused
  await client.query('begin')
  try {
    const tok = (await client.query(`insert into employee_sessions (emp_id) values ($1) returning token`, [E])).rows[0].token
    const file = async d => {
      await client.query('savepoint s')
      try { await client.query(`select employee_submit_regularization($1,$2,$3::date,'09:00','18:00','test')`, [tok, E, d]); await client.query('release savepoint s'); return { ok: true } }
      catch (e) { await client.query('rollback to savepoint s'); return { ok: false, msg: e.message } }
    }
    const res = []
    for (let i = 1; i <= 5; i++) res.push(await file(`2026-11-0${i}`))
    check('5 new requests are accepted', res.every(r => r.ok), res.map(r => r.ok).join(','))
    const sixth = await file('2026-11-06')
    check('the 6th is refused (limit still 5)', !sixth.ok && /already used all 5/.test(sixth.msg), sixth.msg)
  } finally { await client.query('rollback') }
  check('test rolled back (still 0 counting)', (await counted(E)) === 0)
} finally { await client.end() }
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
