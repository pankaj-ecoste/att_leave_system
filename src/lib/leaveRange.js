// plan.md §58 — pure helpers for "apply for several days at once, then wait for approval".
// The server is the authority (employee_apply_leave_range); these only drive the form's preview and friendly hints.

// LOP, Work From Home and On Duty are never made to wait.
export const EXEMPT_FROM_WAIT = ['LOP', 'Work From Home', 'On Duty']

const ymd = s => String(s).slice(0, 10)

// Every date from `from` to `to` (inclusive, "YYYY-MM-DD") except Sundays. Listed holidays are skipped by the server.
// A single date (to empty or equal) is returned as-is, even a Sunday, exactly like a one-day application.
export function daysInRange(from, to) {
  const a = ymd(from || ''), b = ymd(to || '') || a
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) return []
  if (a === b) return [a]
  const out = []
  for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z'); t += 86400000) {
    const d = new Date(t)
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// True when this person already has a request of this type waiting for approval whose date has not passed.
// (Same rule as the server: old pending requests never lock anyone out.)
export function hasWaitingRequest(leaves, empId, leaveType, today) {
  if (EXEMPT_FROM_WAIT.includes(leaveType)) return false
  return (leaves || []).some(l => l.empId === empId && l.leaveType === leaveType &&
    (l.status === 'Pending' || l.status === 'Manager Approved') && ymd(l.date) >= ymd(today))
}

// "2026-11-03", or "2026-11-03 to 2026-11-05" for several days.
export function rangeLabel(dates) {
  if (!dates || !dates.length) return ''
  return dates.length === 1 ? ymd(dates[0]) : `${ymd(dates[0])} to ${ymd(dates[dates.length - 1])}`
}
