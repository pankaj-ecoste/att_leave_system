// Pure ranking logic behind the admin Analytics tab (plan.md §45). Every function takes plain
// data in and returns a ranked list out — no network, no browser — so each rule is unit-tested.
// Database-side facts (device resets, travel) arrive already aggregated per person; this file
// only decides how people are ranked and what the one-line detail says.
import { effectiveStdHours, graceMinutesUsed } from './datetime'
import { findLeaveType } from './constants'

export const LATE_OUT_CUTOFF = '19:00' // "punched out beyond 7 pm" = strictly after this
export const TOP_N = 10

// 'YYYY-MM' -> { from, to } as 'YYYY-MM-DD' (first and last day of that month).
export function monthBounds(yyyyMm) {
  const [y, m] = String(yyyyMm).split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

// Highest first; ties broken by name so the order never jumps around between renders.
// People with a zero (or missing) value are not ranked — "nobody" is a valid answer.
export function rankTop(rows, limit = TOP_N) {
  return rows
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
}

const oneDecimal = n => Math.round(n * 10) / 10

// 1. Days on which the 15-minute grace period was used (arrived/stayed up to 15 min short of
// the day's hours, forgiven automatically) — same rule that decides the day's status.
export function graceRanking(records, employees, globalStdHours) {
  const byId = new Map((employees || []).map(e => [e.id, e]))
  const acc = new Map()
  for (const rec of records || []) {
    const emp = byId.get(rec.empId)
    if (!emp) continue
    const minutes = graceMinutesUsed(rec, effectiveStdHours(emp, globalStdHours))
    if (!minutes) continue
    const a = acc.get(emp.id) || { name: emp.name, company: emp.company, value: 0, minutes: 0 }
    a.value += 1
    a.minutes += minutes
    acc.set(emp.id, a)
  }
  return rankTop([...acc.values()].map(a => ({ ...a, detail: `${a.value} day${a.value !== 1 ? 's' : ''} · ${a.minutes} min forgiven in total` })))
}

// 2. Leave days taken — Approved, real time off only. Work From Home, On Duty and the hour-long
// Partial Leaves are not days off, so they are left out; a half-day leave counts 0.5.
export function leaveRanking(leaves, from, to) {
  const acc = new Map()
  for (const l of leaves || []) {
    if (!l || l.status !== 'Approved' || !l.date || l.date < from || l.date > to) continue
    const lt = findLeaveType(l.leaveType)
    if (!lt || lt.present) continue
    const key = l.empId || l.empName
    const a = acc.get(key) || { name: l.empName, company: l.company, value: 0, applications: 0 }
    a.value += l.dayPart === 'first_half' || l.dayPart === 'second_half' ? 0.5 : 1
    a.applications += 1
    acc.set(key, a)
  }
  return rankTop([...acc.values()].map(a => ({ ...a, detail: `${a.value} day${a.value !== 1 ? 's' : ''} of leave (${a.applications} approved application${a.applications !== 1 ? 's' : ''})` })))
}

// Indian calendar date ('YYYY-MM-DD') of an ISO timestamp.
function istDate(iso) {
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 3. Attendance-correction requests filed in the month (any decision), with how many were approved.
export function regularizationRanking(regs, from, to) {
  const acc = new Map()
  for (const r of regs || []) {
    if (!r) continue
    const filed = r.createdAt ? istDate(r.createdAt) : null
    if (!filed || filed < from || filed > to) continue
    const key = r.empId || r.empName
    const a = acc.get(key) || { name: r.empName, company: r.company, value: 0, approved: 0 }
    a.value += 1
    if (r.status === 'Approved') a.approved += 1
    acc.set(key, a)
  }
  return rankTop([...acc.values()].map(a => ({ ...a, detail: `${a.value} request${a.value !== 1 ? 's' : ''} filed, ${a.approved} approved` })))
}

// 4. Device resets HR had to do for this person — rows come from the database already counted
// per person: { name, inRange, total }.
export function deviceResetRanking(rows) {
  return rankTop((rows || []).map(r => ({
    name: r.name, company: r.company, value: r.inRange,
    detail: `${r.inRange} reset${r.inRange !== 1 ? 's' : ''} this month · ${r.total} in the last year`,
  })))
}

// 5-7. Travel, from per-person facts the database aggregated:
// { name, company, visits, km, bestDayVisits, bestDayDate }.
export function visitsMonthRanking(rows) {
  return rankTop((rows || []).map(r => ({ name: r.name, company: r.company, value: r.visits, detail: `${r.visits} visit${r.visits !== 1 ? 's' : ''} this month` })))
}
export function visitsDayRanking(rows) {
  return rankTop((rows || []).map(r => ({ name: r.name, company: r.company, value: r.bestDayVisits, detail: r.bestDayDate ? `${r.bestDayVisits} visits in one day, on ${r.bestDayDate}` : `${r.bestDayVisits} visits in one day` })))
}
export function kmMonthRanking(rows) {
  return rankTop((rows || []).map(r => ({ name: r.name, company: r.company, value: oneDecimal(r.km), detail: `${oneDecimal(r.km)} km this month` })))
}

// 8. Days the person punched out after 7 pm. String compare is safe: times are zero-padded 'HH:MM'.
export function lateOutRanking(records, employees, cutoff = LATE_OUT_CUTOFF) {
  const byId = new Map((employees || []).map(e => [e.id, e]))
  const acc = new Map()
  for (const rec of records || []) {
    const emp = byId.get(rec.empId)
    const out = rec.outTime ? String(rec.outTime).slice(0, 5) : null
    if (!emp || !out || out <= cutoff) continue
    const a = acc.get(emp.id) || { name: emp.name, company: emp.company, value: 0, latest: out }
    a.value += 1
    if (out > a.latest) a.latest = out
    acc.set(emp.id, a)
  }
  return rankTop([...acc.values()].map(a => ({ ...a, detail: `${a.value} day${a.value !== 1 ? 's' : ''} after 7 pm · latest ${a.latest}` })))
}
