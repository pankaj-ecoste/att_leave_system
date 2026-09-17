#!/usr/bin/env node
// One-off: apply supabase/migrations/0043_emp_num_blank_guard_and_backfill.sql directly
// (apply-migrations.mjs full-replay is broken at migration 0010 on prod — see plan.md
// §13). Redefines admin_update_employee (emp_num now uses nullif(btrim(...), '') so a
// blank/whitespace edit can never silently overwrite a real employee number) and
// backfills any row currently sitting blank with the next number in sequence. See
// plan.md §27.
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     node scripts/apply-0043-emp-num-blank-guard-and-backfill.mjs

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

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0043_emp_num_blank_guard_and_backfill.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const MARKER = "nullif(btrim(p_data->>'empNum')" // present in the fixed body, absent from the old one

async function getFnDef(client) {
  const { rows } = await client.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_update_employee'
  `)
  return rows[0]?.def || ''
}

async function getBlankRows(client) {
  const { rows } = await client.query(`
    select id, name, emp_num, joining_date
    from employees
    where deleted_at is null and (emp_num is null or btrim(emp_num) = '')
    order by joining_date asc nulls last, created_at asc
  `)
  return rows
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const before = await getFnDef(client)
    console.log('Live admin_update_employee already has the fix:', before.includes(MARKER))

    const blankBefore = await getBlankRows(client)
    console.log(`Rows with a blank/whitespace emp_num before backfill (${blankBefore.length}):`)
    for (const r of blankBefore) console.log(`  ${r.id}  ${r.name}  emp_num=${JSON.stringify(r.emp_num)}  joined=${r.joining_date}`)

    await client.query(sql)
    console.log('Applied 0043_emp_num_blank_guard_and_backfill.sql.')

    const after = await getFnDef(client)
    if (!after.includes(MARKER)) {
      console.error('FATAL: migration ran but admin_update_employee is missing the expected fix.')
      process.exit(1)
    }
    console.log('Live admin_update_employee now has the fix: true')

    const blankAfter = await getBlankRows(client)
    console.log(`Rows with a blank/whitespace emp_num after backfill (${blankAfter.length}) — should be 0.`)
    if (blankAfter.length > 0) {
      console.error('FATAL: backfill ran but some rows are still blank.')
      process.exit(1)
    }

    if (blankBefore.length > 0) {
      const ids = blankBefore.map(r => r.id)
      const { rows: fixed } = await client.query(
        `select id, name, emp_num from employees where id = any($1::uuid[]) order by emp_num`,
        [ids]
      )
      console.log('Assigned:')
      for (const r of fixed) console.log(`  ${r.name} -> ${r.emp_num}`)
    }
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
