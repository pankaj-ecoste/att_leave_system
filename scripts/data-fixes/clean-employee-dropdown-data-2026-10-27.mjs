#!/usr/bin/env node
// plan.md §54 — one-time clean-up of Job Title / Department / Business Unit / Location (and a few
// reporting managers) on existing employees, plus seeding of the dropdown lists.
//
// Source of truth: HR's final sheet (2026-10-27). The rows where the sheet differs from the system are
// in SHEET_FIXES / MANAGER_FIXES (by employee number). Then RULES (ALIASES) tidy the spelling: spacing,
// case, typos, true duplicates -> one official spelling. A value with no alias is kept as typed (tidied).
// An alias of null = a company name typed in the wrong box: listed for HR and left UNCHANGED.
// Lines marked (inferred) are NOT in the sheet — chosen from what the sheet shows; the dry run lists them.
//
// Everything runs in ONE transaction. If migration 0069 is not there yet, the same transaction applies it.
//   * DEFAULT = DRY RUN: full rehearsal (migration + seed + updates + verification), then ROLLBACK.
//   * --apply: JSON backup of the affected employees first (C:\ecoste\backups), then the same, COMMITTED.
//
// Usage: DATABASE_URL=... node scripts/data-fixes/clean-employee-dropdown-data-2026-10-27.mjs [--apply]
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')

// ---- pure helpers -------------------------------------------------------------------------------
const tidy = s => String(s ?? '').replace(/\s+/g, ' ').trim()
const keyOf = s => tidy(s).toLowerCase().replace(/\s*[-–—]\s*/g, '-')
// no alias: keep the words, but write dashes as " - " (en/em dash -> hyphen)
const spaceDashes = s => tidy(s).replace(/\s*[-–—]\s*/g, ' - ')

const ALIASES = {
  job_title: {
    'operator': 'Operator', 'cnc operator': 'CNC Operator',
    'cre': 'Customer Relationship Executive', 'customer relations executive': 'Customer Relationship Executive',
    'customer relationship executive': 'Customer Relationship Executive',
    'bde': 'Business Development Executive', 'executive-business development': 'Business Development Executive',
    'bdm': 'Business Development Manager', 'sr. bdm': 'Senior Business Development Manager',
    'security gaurd': 'Security Guard', 'supervisor': 'Supervisor', 'folklift driver': 'Forklift Driver',
    'cnc manager-prodcution': 'CNC Manager - Production',
    'procees co-ordinator': 'Process Coordinator',
    'procees co-ordinator-intern': 'Process Coordinator Intern', 'process coordination intern': 'Process Coordinator Intern',
    'executive-human resources': 'HR Executive',
    'cnc edge banding trainee': 'CNC Edge Banding Trainee',
    'profile wrapping machine trainee': 'Profile Wrapping Machine Trainee',
    'production': null, // a department, not a job title — HR to say what this person's title is
  },
  department: {
    'hr': 'Human Resources', 'human resource': 'Human Resources', 'human resources': 'Human Resources',
    'production': 'Production', 'production-maintenance': 'Production', 'production-lamora': 'Production',
    'installation/finance': 'Accounts & Finance', 'managment': 'Management',
    'admin': 'Administration', 'administration': 'Administration',
    'metamask': null, 'meta mask': null, 'production-metamask': null, // a company name, not a department
  },
  business_unit: {
    'ho': 'Head Office', 'head office': 'Head Office', 'plant': 'Plant',
    'lamora': 'Plant', // Lamora company was removed; these 6 are plant production staff at Plant Location
    'metamask': 'Meta Mask', 'meta mask': 'Meta Mask', 'ecoste': 'Ecoste',
    'sr. bdm': null, 'asma': null, 'asma traexim pvt ltd': null, // a title / a company name — decided per person in SHEET_FIXES
  },
  location: {
    'ho': 'Head Office', 'head office': 'Head Office',
    'plant': 'Plant Location', 'plant location': 'Plant Location',
    'ghirtoni': 'Ghitorni', 'shalimar bagh office': 'Shalimar Bagh',
    'metamask': null, // a company name, not a place — decided per person in SHEET_FIXES
  },
}

// Where HR's final sheet differs from the system (by employee number), column -> sheet value.
const SHEET_FIXES = {
  '1183': { business_unit: 'Metamask', location: 'Ghitorni' },
  '1131': { location: 'WFH' },
  '1268': { business_unit: 'Head Office', location: 'Shalimar Bagh' },
  '1198': { location: 'Shalimar Bagh' }, '1199': { location: 'Shalimar Bagh' }, '1174': { location: 'Shalimar Bagh' },
  '1211': { location: 'Mumbai', business_unit: 'Ecoste' }, // BU (inferred): Mumbai, like his colleague Aditya Chavan (Ecoste)
  '1264': { business_unit: 'Head Office', location: 'Jammu' },
  '1271': { business_unit: 'Metamask' },
  '1275': { business_unit: 'Metamask', location: 'Ghitorni' }, // location (inferred): sheet says "Metamask" (a company); his team sits at Ghitorni
  '1249': { business_unit: 'Head Office' }, // (inferred): sheet says "Asma" (a company); his location is HO
}
// Reporting-manager corrections from the sheet: employee number -> manager's employee number.
const MANAGER_FIXES = { '1271': '1269', '1275': '1254', '1190': '1213' } // Prithvi->Paramjit; Bhaskar->Ankur Hora (Metamask #1254); Pooja->Ankur Hora (Asma #1213)

const COLUMN = { job_title: 'job_title', department: 'department', business_unit: 'business_unit', location: 'location_info' }

/** -> { value: string|null (null = decision/blank), decision: bool } */
export function canonical(kind, raw) {
  if (raw == null || tidy(raw) === '') return { value: null, decision: false }
  const k = keyOf(raw)
  if (Object.prototype.hasOwnProperty.call(ALIASES[kind], k)) {
    const v = ALIASES[kind][k]
    return v === null ? { value: null, decision: true } : { value: v, decision: false }
  }
  return { value: spaceDashes(raw), decision: false }
}

// ---- plan (read-only) ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2) }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows: emps } = await client.query(
  `select id, emp_num, name, company, manager, manager_emp_id, job_title, department, business_unit, location_info from employees where deleted_at is null order by name`)

const changes = [], decisions = []
const lists = { job_title: new Set(), department: new Set(), business_unit: new Set(), location: new Set() }
for (const e of emps) {
  for (const kind of Object.keys(COLUMN)) {
    const raw = SHEET_FIXES[e.emp_num]?.[kind] ?? e[COLUMN[kind]]
    const { value, decision } = canonical(kind, raw)
    if (decision) { decisions.push({ emp: `${e.emp_num} ${tidy(e.name)}`, company: e.company, kind, value: raw }); continue }
    if (value === null) continue
    lists[kind].add(value)
    if (e[COLUMN[kind]] !== value) changes.push({ id: e.id, who: `${e.emp_num} ${tidy(e.name)}`, empNum: e.emp_num, kind, from: e[COLUMN[kind]], to: value })
  }
}
const byNum = Object.fromEntries(emps.map(e => [e.emp_num, e]))
const mgrChanges = Object.entries(MANAGER_FIXES).map(([emp, mgr]) => ({ emp: byNum[emp], mgr: byNum[mgr] }))
for (const m of mgrChanges) if (!m.emp || !m.mgr) throw new Error('Manager fix refers to a missing employee')

console.log(`Employees checked: ${emps.length}\n`)
for (const kind of Object.keys(COLUMN)) {
  const grouped = {}
  for (const c of changes.filter(x => x.kind === kind)) {
    const k = `${JSON.stringify(c.from)} -> ${c.to}` + (SHEET_FIXES[c.empNum]?.[kind] ? `   [sheet fix: ${c.who}]` : '')
    grouped[k] = (grouped[k] || 0) + 1
  }
  console.log(`=== ${kind}: ${changes.filter(x => x.kind === kind).length} cells change; list will have ${lists[kind].size} values ===`)
  for (const [k, n] of Object.entries(grouped).sort()) console.log(`  ${String(n).padStart(3)} x  ${k}`)
  console.log()
}
console.log('=== reporting-manager changes (these decide who approves leave first) ===')
for (const m of mgrChanges) console.log(`  ${m.emp.emp_num} ${tidy(m.emp.name)} (${m.emp.company}): ${tidy(m.emp.manager) || '(none)'} -> ${tidy(m.mgr.name)} #${m.mgr.emp_num} (${m.mgr.company})`)
console.log(`\n=== STILL NEEDS HR's DECISION (${decisions.length}) — left UNCHANGED, not added to any list ===`)
console.table(decisions)
for (const kind of Object.keys(COLUMN)) console.log(`\n--- final ${kind} list (${lists[kind].size}) ---\n` + [...lists[kind]].sort((a, b) => a.localeCompare(b)).join(' | '))

// ---- one transaction: (migration) + seed + updates + verify; commit only with --apply ------------
if (APPLY) {
  fs.mkdirSync('C:\\ecoste\\backups', { recursive: true })
  const file = `C:\\ecoste\\backups\\employee-dropdown-fields-before-cleanup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
  fs.writeFileSync(file, JSON.stringify(emps, null, 2))
  console.log('\nBackup written:', file)
}
try {
  await client.query('begin')
  const { rows: [t] } = await client.query(`select to_regclass('public.dropdown_options') as t`)
  if (!t.t) {
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0069_dropdown_options.sql'), 'utf8'))
    console.log('\n(migration 0069 applied inside this transaction)')
  }
  for (const kind of Object.keys(COLUMN)) for (const v of lists[kind]) {
    await client.query(`insert into dropdown_options(kind, value) values ($1, $2) on conflict (kind, lower(value)) do nothing`, [kind, v])
  }
  for (const c of changes) {
    const r = await client.query(`update employees set ${COLUMN[c.kind]} = $1 where id = $2 and ${COLUMN[c.kind]} is not distinct from $3`, [c.to, c.id, c.from])
    if (r.rowCount !== 1) throw new Error(`update did not hit exactly one row: ${c.who} ${c.kind}`)
  }
  for (const m of mgrChanges) {
    const r = await client.query(`update employees set manager_emp_id = $1, manager = $2, updated_at = now() where id = $3`, [m.mgr.id, m.mgr.name, m.emp.id])
    if (r.rowCount !== 1) throw new Error(`manager update failed: ${m.emp.name}`)
  }
  // verify: every non-blank value is in its list (except the deliberate leftovers); managers are linked
  const left = new Set(decisions.map(d => `${d.kind}|${d.value}`))
  const { rows: now } = await client.query(`select name, job_title, department, business_unit, location_info from employees where deleted_at is null`)
  let bad = 0
  for (const r of now) for (const kind of Object.keys(COLUMN)) {
    const v = r[COLUMN[kind]]
    if (v == null || v === '' || left.has(`${kind}|${v}`)) continue
    const { rows } = await client.query(`select 1 from dropdown_options where kind = $1 and value = $2`, [kind, v])
    if (!rows.length) { bad++; console.error('NOT IN LIST after clean-up:', r.name, kind, JSON.stringify(v)) }
  }
  if (bad) throw new Error(`${bad} value(s) not in list`)
  const { rows: cnt } = await client.query(`select kind, count(*)::int n from dropdown_options group by 1 order by 1`)
  console.log('\nLists after clean-up:', cnt.map(r => `${r.kind}=${r.n}`).join(', '))
  if (APPLY) { await client.query('commit'); console.log(`COMMITTED. ${changes.length} cells + ${mgrChanges.length} managers updated, lists seeded.`) }
  else { await client.query('rollback'); console.log(`\nDRY RUN passed (${changes.length} cell updates + ${mgrChanges.length} managers rehearsed) — ROLLED BACK, nothing changed. Re-run with --apply.`) }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED and rolled back:', e.message); process.exitCode = 1
}
await client.end()
