#!/usr/bin/env node
// Stage G — the only data that crosses from the old project into HRMS: employees and
// holidays (plan.md Phase 1 revised). Everything else (attendance, leave applications
// incl. the 281 pending, location logs, audit logs, sessions) deliberately stays behind.
//
// What this does, in order:
//   1. Read all employees + holidays from the OLD project
//   2. Insert into HRMS, hashing each plaintext PIN with pgcrypto on the way in
//      (P1-6 — the old PINs are plaintext, this is the clean moment to fix that)
//   3. Re-link manager_emp_id using the new ids (old ids don't survive the copy)
//   4. Set employment_status = 'Confirmed' for all of them (P2-4/Q-9 — they're
//      established staff; only new hires start on Probation going forward)
//   5. Generate leave balances fresh from the policy — CL 12 / EL 6 / SL 4, pro-rata
//      by joining_date for anyone who joined during the current financial year
//      (plan.md §6A) — NOT a copy of the old leave_balances table (1 meaningless row)
//
// Usage:
//   OLD_DATABASE_URL="postgresql://...old project..." \
//   NEW_DATABASE_URL="postgresql://...HRMS..." \
//     node scripts/seed-employees-and-holidays.mjs

import pg from 'pg'

const oldUrl = process.env.OLD_DATABASE_URL
const newUrl = process.env.NEW_DATABASE_URL
if (!oldUrl || !newUrl) {
  console.error('Set OLD_DATABASE_URL (source) and NEW_DATABASE_URL (HRMS) first.')
  process.exit(2)
}

const CURRENT_FY_START_YEAR = (() => {
  const now = new Date()
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
})()

// Whole months of service *within the current financial year*, counting the joining
// month as a full month if joined on/before the 15th (a reasonable, simple cutoff —
// admins can hand-adjust any individual balance afterwards from the Employees screen).
function monthsRemainingInFY(joiningDate) {
  if (!joiningDate) return 12
  const fyStart = new Date(CURRENT_FY_START_YEAR, 3, 1) // 1 April
  const fyEnd = new Date(CURRENT_FY_START_YEAR + 1, 2, 31) // 31 March
  const join = new Date(joiningDate)
  if (join <= fyStart) return 12 // joined before this FY started — full quota
  if (join > fyEnd) return 0 // joins after this FY ends (shouldn't happen for existing staff)
  const effectiveStart = join.getDate() <= 15 ? join : new Date(join.getFullYear(), join.getMonth() + 1, 1)
  const months = (fyEnd.getFullYear() - effectiveStart.getFullYear()) * 12 + (fyEnd.getMonth() - effectiveStart.getMonth()) + 1
  return Math.max(0, Math.min(12, months))
}

async function main() {
  const oldDb = new pg.Client({ connectionString: oldUrl, ssl: { rejectUnauthorized: false } })
  const newDb = new pg.Client({ connectionString: newUrl, ssl: { rejectUnauthorized: false } })
  await oldDb.connect()
  await newDb.connect()

  const { rows: oldEmployees } = await oldDb.query('select * from employees order by name')
  const { rows: oldHolidays } = await oldDb.query('select * from holidays order by date')
  console.log(`Read ${oldEmployees.length} employees, ${oldHolidays.length} holidays from the old project.`)

  const existing = await newDb.query('select count(*)::int as n from employees')
  if (existing.rows[0].n > 0) {
    console.error(`HRMS already has ${existing.rows[0].n} employee(s). Refusing to double-import — clear the table first if this is intentional.`)
    process.exit(1)
  }

  const oldIdToNewId = new Map()

  await newDb.query('begin')
  try {
    // Pass 1: insert every employee, hashing their (plaintext) PIN on the way in.
    // manager_emp_id is deliberately left null here — old ids don't exist in HRMS yet.
    for (const e of oldEmployees) {
      const res = await newDb.query(
        `insert into employees (
           emp_num, name, pin, company, job_title, business_unit, department, sub_department,
           location_info, cost_center, manager, email, phone, joining_date, active,
           employment_status
         ) values ($1,$2,crypt($3, gen_salt('bf')),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Confirmed')
         returning id`,
        [
          e.emp_num, e.name, e.pin || '0000', e.company, e.job_title, e.business_unit, e.department,
          e.sub_department, e.location_info, e.cost_center, e.manager, e.email, e.phone,
          e.joining_date, e.active,
        ]
      )
      oldIdToNewId.set(e.id, res.rows[0].id)
    }
    console.log(`Inserted ${oldIdToNewId.size} employees.`)

    // Pass 2: re-link manager_emp_id now that every employee has a new id.
    let relinked = 0
    for (const e of oldEmployees) {
      if (!e.manager_emp_id) continue
      const newManagerId = oldIdToNewId.get(e.manager_emp_id)
      if (!newManagerId) continue // old manager id pointed at someone not in this export
      await newDb.query('update employees set manager_emp_id = $1 where id = $2', [newManagerId, oldIdToNewId.get(e.id)])
      relinked++
    }
    console.log(`Re-linked ${relinked} manager relationships.`)

    // Pass 3: holidays — straight copy.
    for (const h of oldHolidays) {
      await newDb.query('insert into holidays (date, name, type) values ($1,$2,$3)', [h.date, h.name, h.type])
    }
    console.log(`Inserted ${oldHolidays.length} holidays.`)

    // Pass 4: leave balances, generated fresh from the policy (plan.md §6A) — not
    // copied from the old table, which has 1 meaningless row.
    let balanceRows = 0
    for (const e of oldEmployees) {
      const months = monthsRemainingInFY(e.joining_date)
      const cl = Math.min(12, months) // 1/month
      const el = Math.min(6, months * 0.5) // 0.5/month
      const sl = 4 // not pro-rated per policy
      const newId = oldIdToNewId.get(e.id)
      for (const [leaveType, quota] of [['Casual Leave', cl], ['Earned Leave', el], ['Sick Leave', sl]]) {
        await newDb.query(
          `insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
           values ($1,$2,$3,0,$3,$3,'Days')
           on conflict (emp_id, leave_type, financial_year) do nothing`,
          [newId, leaveType, quota]
        )
        balanceRows++
      }
    }
    console.log(`Generated ${balanceRows} leave balance rows (Casual/Earned/Sick x ${oldIdToNewId.size} employees).`)

    await newDb.query('commit')
  } catch (err) {
    await newDb.query('rollback')
    console.error('Seed failed, rolled back:', err.message)
    process.exit(1)
  }

  await oldDb.end()
  await newDb.end()
  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
