import { REGULARIZATION_MONTHLY_LIMIT } from './constants'

// How many attendance-correction requests this employee has used this calendar month
// (plan.md §39). Counted by the month the request was FILED in IST, every request
// included whatever its status — the same rule employee_submit_regularization enforces
// in the database, which is the real authority; this only drives the on-screen counter.
//
// todayIst is 'YYYY-MM-DD'. createdAt is the row's ISO timestamp.
export function regularizationQuota(regularizations, todayIst, limit = REGULARIZATION_MONTHLY_LIMIT) {
  const month = String(todayIst).slice(0, 7)
  const used = (regularizations || []).filter(r => r?.createdAt && istMonthOf(r.createdAt) === month).length
  return { used, limit, left: Math.max(limit - used, 0), reached: used >= limit }
}

// 'YYYY-MM' of an instant as seen in India (UTC+5:30, no daylight saving).
export function istMonthOf(isoTimestamp) {
  const ms = new Date(isoTimestamp).getTime()
  if (Number.isNaN(ms)) return null
  const d = new Date(ms + 5.5 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
