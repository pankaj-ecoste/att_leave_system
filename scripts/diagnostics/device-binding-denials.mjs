#!/usr/bin/env node
// READ-ONLY diagnostic (plan.md §38) — why do a few staff get "this is not your registered
// device" while swearing it's the same phone and browser?
//
// The device id lives in the browser's localStorage. If a phone/browser ever loses that
// storage (cleaner app, "clear data", private tab, Safari's 7-day cleanup, opening the
// link from inside WhatsApp's own browser...), the app invents a NEW id and the server
// sees a stranger. The tell-tale pattern in the audit log is the same person cycling:
// RESET -> BOUND -> (some days) -> BLOCKED -> RESET -> ...  This script lays that out.
//
// Since migration 0058, login events carry a note in [brackets]: id:new / restored-from-X /
// known, whether the browser agreed to keep its storage, and how the app was opened (e.g.
// "InAppBrowser(WhatsApp)", "iPhone Safari home-screen-app"). A BLOCKED row with id:new is
// a wiped-storage or genuinely different phone; LOGIN_DEVICE_RESTORED rows count the
// people the backup copies saved.
//
// Only SELECTs. Nothing is changed.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/diagnostics/device-binding-denials.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}

const ACTIONS = ['LOGIN_DEVICE_BOUND', 'LOGIN_DEVICE_BLOCKED', 'LOGIN_DEVICE_RESTORED', 'PUNCH_DEVICE_BOUND', 'PUNCH_DEVICE_BLOCKED', 'PUNCH_DEVICE_RESET']
const nameOf = detail => (detail || '').split(' — ')[0].trim()

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: counts } = await client.query(
      `select action, count(*)::int as n, min(ts)::date as first, max(ts)::date as last
         from audit_logs where action = any($1) group by action order by action`, [ACTIONS])
    console.log('\n== Device events in the audit log (all time, retained 1 year) ==')
    console.table(counts)

    const { rows: byDay } = await client.query(
      `select ts::date as day,
              count(*) filter (where action in ('LOGIN_DEVICE_BLOCKED','PUNCH_DEVICE_BLOCKED'))::int as blocked,
              count(*) filter (where action = 'PUNCH_DEVICE_RESET')::int as resets
         from audit_logs where action = any($1) and ts > now() - interval '30 days'
         group by 1 order by 1`, [ACTIONS])
    console.log('\n== Last 30 days, per day ==')
    console.table(byDay)

    const { rows: events } = await client.query(
      `select ts, action, detail from audit_logs where action = any($1) order by ts`, [ACTIONS])
    const perPerson = new Map()
    for (const e of events) {
      const n = nameOf(e.detail)
      if (!perPerson.has(n)) perPerson.set(n, [])
      perPerson.get(n).push(e)
    }
    const ranked = [...perPerson.entries()]
      .map(([name, ev]) => ({
        name,
        blocked: ev.filter(x => x.action.endsWith('BLOCKED')).length,
        resets: ev.filter(x => x.action === 'PUNCH_DEVICE_RESET').length,
        ev,
      }))
      .filter(p => p.blocked > 0 || p.resets > 0)
      .sort((a, b) => (b.resets - a.resets) || (b.blocked - a.blocked))

    console.log('\n== People with blocks or resets (worst first) ==')
    console.table(ranked.map(({ name, blocked, resets }) => ({ name, blocked, resets })).slice(0, 25))

    console.log('\n== Timeline for the top 6 (oldest -> newest). Repeating RESET -> BOUND -> BLOCKED = the id keeps getting lost ==')
    for (const p of ranked.slice(0, 6)) {
      console.log(`\n-- ${p.name}`)
      for (const e of p.ev) console.log(`   ${e.ts.toISOString().slice(0, 16).replace('T', ' ')}  ${e.action}  ${(e.detail || '').match(/\[.*\]/)?.[0] || ''}`)
    }

    const { rows: bound } = await client.query(
      `select count(*) filter (where active)::int as active_total,
              count(*) filter (where active and punch_device_id is not null)::int as active_bound,
              count(*) filter (where active and punch_device_id is null)::int as active_unbound
         from employees`)
    console.log('\n== Employees right now ==')
    console.table(bound)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
