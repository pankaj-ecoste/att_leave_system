// Fixes plan.md §4.2 #1 and #2 — the two attendance-correctness bugs that cost real
// data: `TODAY` was a UTC date computed once at page load (anyone punching between
// 00:00-05:30 IST recorded against yesterday, and a tab left open overnight kept using
// the stale date), and overnight shifts (21:00 -> 06:00) computed a negative duration
// that got clamped to 0, so night-shift staff were permanently marked Absent.
//
// Pure functions only — no React, no network — so they're testable alone (plan.md §8C).

import { DAY_TYPES, findLeaveType, ABSENT_STATUS, PRESENT_STATUS, HALF_DAY_STATUS, LEAVE_STATUS, WFH_STATUS, ON_DUTY_STATUS, WEEK_OFF_STATUS, HOLIDAY_STATUS } from './constants'

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

// Adding the IST offset to the current UTC instant and then reading its UTC fields
// yields IST wall-clock values, regardless of the machine's own local timezone — this
// must not depend on `new Date().getHours()`, which reads the *local* timezone of
// whichever machine runs it (a Vercel server, a browser outside India, etc).
function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Today's date in IST, as YYYY-MM-DD. Call this at the point of use — never cache it
// in a module-level constant, or it goes stale the moment the tab is left open past
// midnight.
export function todayIST() {
  const d = nowIST()
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

// Current time in IST, as HH:MM.
export function nowTimeIST() {
  const d = nowIST()
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

// Hours worked between two "HH:MM" punches. Wraps past midnight for overnight shifts
// (e.g. in=21:00, out=06:00 -> 9h, not a clamped-to-zero negative duration).
export function calcRawHrs(inTime, outTime) {
  if (!inTime || !outTime) return 0
  const [ih, im] = inTime.split(':').map(Number)
  const [oh, om] = outTime.split(':').map(Number)
  let minutes = oh * 60 + om - (ih * 60 + im)
  if (minutes < 0) minutes += 24 * 60
  return minutes / 60
}

// Day status for one attendance row. `stdHours` is always read from app_settings, never
// hardcoded (G-3) — the half-day/absent boundary is std hours ÷ 2, matching what the
// settings screen has always promised (§4.2 #4, previously hardcoded to 4.5).
// `dayType` ('working' / 'week_off' / 'holiday') decides what an *unpunched* day means —
// this is what makes weekends and holidays stop being counted as Absent (§4.2 #3).
export function calcStatus(rec, stdHours, dayType = DAY_TYPES.WORKING) {
  if (rec.leaveType) {
    const lt = findLeaveType(rec.leaveType)
    if (lt && !lt.present) return LEAVE_STATUS
    if (lt?.label === 'Work From Home') return WFH_STATUS
    if (lt?.label === 'On Duty') return ON_DUTY_STATUS
  }

  if (rec.inTime) {
    const raw = calcRawHrs(rec.inTime, rec.outTime)
    const deduct = rec.leaveType ? findLeaveType(rec.leaveType)?.deduct || 0 : 0
    const eff = Math.max(0, raw - deduct)
    const halfDayThreshold = stdHours / 2
    if (eff < halfDayThreshold) return ABSENT_STATUS
    if (eff < stdHours) return HALF_DAY_STATUS
    return PRESENT_STATUS
  }

  if (dayType === DAY_TYPES.WEEK_OFF) return WEEK_OFF_STATUS
  if (dayType === DAY_TYPES.HOLIDAY) return HOLIDAY_STATUS

  // No punch, no leave, an ordinary working day — fall back to a biometric-import
  // status code if that's all we have.
  if (rec.bioStatusRaw) {
    const b = String(rec.bioStatusRaw).toUpperCase().trim()
    if (b === 'P') return PRESENT_STATUS
    if (b === 'A') return ABSENT_STATUS
    if (b === 'H' || b === 'HD') return HALF_DAY_STATUS
    if (b === 'L') return LEAVE_STATUS
  }
  return ABSENT_STATUS
}

// Financial year for a given date (or today, IST) — 1 April to 31 March, matching
// current_fy() in the database so the app and the DB never disagree about which year
// a balance belongs to.
export function financialYearFor(dateStr = todayIST()) {
  const [y, m] = dateStr.split('-').map(Number)
  return m >= 4 ? y : y - 1
}

// Whole months of service between a joining date and a reference date (or today), used
// for pro-rata leave accrual (CL 1/month, EL 0.5/month — plan.md §6A). Partial months
// don't count, matching "credited in full on 1 April" for anyone who joined before the
// 1st of a given month.
export function monthsOfServiceSince(joiningDateStr, refDateStr = todayIST()) {
  if (!joiningDateStr) return 0
  const [jy, jm, jd] = joiningDateStr.split('-').map(Number)
  const [ry, rm, rd] = refDateStr.split('-').map(Number)
  let months = (ry - jy) * 12 + (rm - jm)
  if (rd < jd) months -= 1
  return Math.max(0, months)
}
