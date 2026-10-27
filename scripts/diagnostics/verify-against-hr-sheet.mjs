#!/usr/bin/env node
// Read-only: compare HR's sheet with the live employees. The sheet file has one pipe-separated line per person:
//   emp_num|name|company-first-word|job title|business unit|department|location|reporting manager
// Spelling variants HR already agreed are the same ("HO" = "Head Office", "HR" = "Human Resources", ...) are NOT
// reported as differences — only real ones. Nothing is changed.
//
// Usage: DATABASE_URL=... node scripts/diagnostics/verify-against-hr-sheet.mjs <sheet.txt>
import pg from 'pg'
import fs from 'fs'

if (!process.env.DATABASE_URL || !process.argv[2]) { console.error('Usage: DATABASE_URL=... node verify-against-hr-sheet.mjs <sheet.txt>'); process.exit(2) }
const tidy = s => String(s ?? '').replace(/\s+/g, ' ').trim()
const key = s => tidy(s).toLowerCase().replace(/\s*[-–—]\s*/g, '-')

// Same spelling groups the clean-up used; everything else is compared as typed (case/spacing/dash-spacing ignored).
const SAME = {
  job: { 'cre': 'customer relationship executive', 'customer relations executive': 'customer relationship executive', 'bde': 'business development executive', 'executive-business development': 'business development executive', 'bdm': 'business development manager', 'sr. bdm': 'senior business development manager', 'procees co-ordinator': 'process coordinator', 'procees co-ordinator-intern': 'process coordinator intern', 'process coordination intern': 'process coordinator intern', 'executive-human resources': 'hr executive' },
  dept: { 'hr': 'human resources', 'human resource': 'human resources', 'installation/finance': 'accounts & finance', 'managment': 'management', 'admin': 'administration' },
  bu: { 'ho': 'head office', 'metamask': 'meta mask' },
  loc: { 'ho': 'head office', 'ghirtoni': 'ghitorni', 'shalimar bagh office': 'shalimar bagh', 'plant': 'plant location' },
}
const norm = (kind, v) => SAME[kind][key(v)] ?? key(v).replace(/-/g, ' - ')

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => l.split('|'))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const { rows: db } = await c.query(`select e.emp_num, e.name, e.company, e.job_title, e.business_unit, e.department, e.location_info, e.manager, m.name as manager_linked, e.deleted_at
  from employees e left join employees m on m.id = e.manager_emp_id`)
const live = db.filter(r => !r.deleted_at)
const byNum = Object.fromEntries(live.map(r => [r.emp_num, r]))
const removed = Object.fromEntries(db.filter(r => r.deleted_at).map(r => [r.emp_num, r]))
const inSheet = new Set(rows.map(r => r[0]))

console.log(`sheet rows: ${rows.length}  |  live in the app: ${live.length}`)
console.log('\nIN SHEET, NOT LIVE IN THE APP:')
rows.filter(r => !byNum[r[0]]).forEach(r => console.log(`  ${r[0]} ${r[1]} ${removed[r[0]] ? '(removed from the app earlier)' : '(never in the app)'}`))
console.log('\nLIVE IN THE APP, NOT IN THE SHEET:')
live.filter(r => !inSheet.has(r.emp_num)).forEach(r => console.log(`  ${r.emp_num} ${tidy(r.name)} | ${r.company}`))

console.log('\nFIELD DIFFERENCES (agreed spelling variants ignored):')
let people = 0
for (const [num, name, co, job, bu, dep, loc, mgr] of rows) {
  const r = byNum[num]
  if (!r) continue
  const out = []
  if (tidy(r.name).toLowerCase() !== tidy(name).toLowerCase()) out.push(`name: sheet "${tidy(name)}" / app "${tidy(r.name)}"`)
  if (!r.company.startsWith(co)) out.push(`company: sheet ${co} / app ${r.company}`)
  for (const [kind, sheetVal, appVal, label] of [['job', job, r.job_title, 'job title'], ['bu', bu, r.business_unit, 'business unit'], ['dept', dep, r.department, 'department'], ['loc', loc, r.location_info, 'location']]) {
    if (norm(kind, sheetVal) !== norm(kind, appVal)) out.push(`${label}: sheet "${tidy(sheetVal) || '(blank)'}" / app "${tidy(appVal) || '(blank)'}"`)
  }
  const appMgr = tidy(r.manager_linked || r.manager)
  if (tidy(mgr).toLowerCase() !== appMgr.toLowerCase()) out.push(`manager: sheet "${tidy(mgr)}" / app "${appMgr || '(none)'}"`)
  if (out.length) { people++; console.log(`${num} ${tidy(r.name)}\n    ` + out.join('\n    ')) }
}
console.log(`\npeople with at least one difference: ${people}`)
await c.end()
