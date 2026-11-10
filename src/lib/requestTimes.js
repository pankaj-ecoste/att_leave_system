// plan.md §60 — On Duty and Work From Home requests are for TODAY ONLY and carry the in-time and out-time the
// person will work; they count only once a manager/admin approves. The database enforces all of this (migration
// 0074); these pure helpers just give the screens the same rules so a mistake is caught before sending.

export const TIMED_LEAVE_TYPES = ['Work From Home', 'On Duty']

export const isTimedLeaveType = type => TIMED_LEAVE_TYPES.includes(type)

// Returns { time?: string } — empty object when the request is fine.
export function validateTimedRequest({ type, date, today, inTime, outTime }) {
  if (!isTimedLeaveType(type)) return {}
  const errs = {}
  if (date !== today) errs.date = `${type} can only be applied for today`
  if (!inTime || !outTime) errs.time = 'Please enter both your in-time and your out-time'
  else if (outTime <= inTime) errs.time = 'Out-time must be after in-time'
  return errs
}

// '09:30:00' -> '09:30'. Rows from the database carry seconds; the screens never show them.
export function hhmm(t) {
  return t ? String(t).slice(0, 5) : null
}

// "09:30 — 18:30" for a leave request that carries times, otherwise null (old rows, other leave types).
export function timesLabel(leave) {
  const a = hhmm(leave?.requestedIn)
  const b = hhmm(leave?.requestedOut)
  return a && b ? `${a} — ${b}` : null
}

// Wording for an own On Duty / WFH request that is still waiting for a decision.
export function awaitingApprovalLabel(leave, hasManager) {
  if (!leave || !isTimedLeaveType(leave.leaveType)) return null
  if (leave.status !== 'Pending' && leave.status !== 'Manager Approved') return null
  return hasManager ? 'Awaiting manager approval' : 'Awaiting admin approval'
}
