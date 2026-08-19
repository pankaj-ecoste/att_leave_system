// Fixes plan.md §4.2 #1 and #2 — the two attendance-correctness bugs that cost real
// data: `TODAY` was a UTC date computed once at page load (anyone punching between
// 00:00-05:30 IST recorded against yesterday, and a tab left open overnight kept using
// the stale date), and overnight shifts (21:00 -> 06:00) computed a negative duration
// that got clamped to 0, so night-shift staff were permanently marked Absent.
//
// Pure functions only — no React, no network — so they're testable alone (plan.md §8C).

import { DAY_TYPES, findLeaveType, ABSENT_STATUS, PRESENT_STATUS, PUNCHED_IN_STATUS, HALF_DAY_STATUS, LEAVE_STATUS, HALF_DAY_LEAVE_STATUS, WFH_STATUS, ON_DUTY_STATUS, WEEK_OFF_STATUS, HOLIDAY_STATUS, WORK_WINDOW_END, GRACE_PERIOD_MIN } from './constants'

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

function minutesOfDay(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// Hours available inside the flexible work window (WORK_WINDOW_END) for a given
// punch-in, or null if this punch-in falls outside the window entirely (Night Shift and
// similar — see calcStatus/hasIncompleteHoursFlag, both of which treat null as "the
// window rule doesn't apply here, fall back to the plain calculation").
function windowAvailableHours(inTime) {
  const inMin = minutesOfDay(inTime)
  const windowEndMin = minutesOfDay(WORK_WINDOW_END)
  if (inMin >= windowEndMin) return null
  return (windowEndMin - inMin) / 60
}

// Today's date in IST, as YYYY-MM-DD. Call this at the point of use — never cache it
// in a module-level constant, or it goes stale the moment the tab is left open past
// midnight.
export function todayIST() {
  const d = nowIST()
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

// N days from today in IST, as YYYY-MM-DD — used for advance-notice rules (e.g. Earned
// Leave's 7-day minimum). Same "call at point of use, never cache" rule as todayIST.
export function daysFromTodayIST(days) {
  const d = nowIST()
  d.setUTCDate(d.getUTCDate() + days)
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
    if (lt && !lt.present) {
      if (rec.dayPart === 'first_half' || rec.dayPart === 'second_half') return HALF_DAY_LEAVE_STATUS
      return LEAVE_STATUS
    }
    if (lt?.label === 'Work From Home') return WFH_STATUS
    if (lt?.label === 'On Duty') return ON_DUTY_STATUS
  }

  if (rec.inTime) {
    // Still punched in, no out-punch yet — hours worked aren't final, so don't run the
    // Present/Half Day/Absent math at all (calcRawHrs treats a missing out-time as 0
    // hours, which used to fall straight through to Absent for anyone mid-shift). Once
    // they punch out, calcStatus runs again with the real out-time and settles into the
    // correct status below — this branch only ever covers the in-progress window.
    if (!rec.outTime) return PUNCHED_IN_STATUS

    const raw = calcRawHrs(rec.inTime, rec.outTime)
    const deduct = rec.leaveType ? findLeaveType(rec.leaveType)?.deduct || 0 : 0
    const available = windowAvailableHours(rec.inTime)
    const cappedRaw = available == null ? raw : Math.min(raw, available)
    const halfDayThreshold = stdHours / 2

    // Punched in too late to ever reach stdHours before the work window closes (e.g.
    // stdHours=9, window 9:00-19:00 -> must punch in by 10:00 to have a chance). If they
    // still stayed through to the window's close — used every minute they had — don't
    // punish that with Half Day/Absent; mark Present and let hasIncompleteHoursFlag
    // surface it separately for admin visibility. Leaving early on top of a late start
    // still falls through to the normal thresholds below.
    if (available != null && available < stdHours && rec.outTime && raw >= available) {
      return PRESENT_STATUS
    }

    // Grace period + Partial Leave credit (plan.md §12 V3 decision 10, HR 2026-08-19).
    // A shortfall against stdHours of up to GRACE_PERIOD_MIN is forgiven automatically.
    // Anything beyond that needs an applied Partial Leave (1hr/2hr) to cover the gap —
    // `deduct` credits those hours back against the shortfall here (the opposite of the
    // old `cappedRaw - deduct`, which made applying Partial Leave push a day *closer* to
    // Half Day instead of covering it). calcOvertimeHours is deliberately untouched —
    // Partial Leave still earns no OT credit for the excused hour.
    const shortfallHrs = Math.max(0, stdHours - cappedRaw - deduct)
    if (shortfallHrs <= GRACE_PERIOD_MIN / 60) return PRESENT_STATUS

    const eff = stdHours - shortfallHrs
    if (eff < halfDayThreshold) return ABSENT_STATUS
    return HALF_DAY_STATUS
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

// Hours worked beyond `stdHours` for one attendance row (plan.md §11 Decision 13 — V2
// Phase B, tracking only, no payroll integration). Net hours mirrors calcStatus's own
// effective-hours calc (raw minus any half-day-leave deduction) so OT and status math
// never disagree about what "hours worked" means for the same row. This single function
// replaces what used to be five separate inline copies (Reports.jsx, PunchPanel.jsx,
// Dashboard.jsx, AttendanceGrid.jsx) — two of which forgot the leave deduction, so a
// half-day-leave day could over-count OT. Deliberately does not apply calcStatus's
// window-availability cap — that cap exists only to keep a late punch-in from being
// marked Half Day/Absent despite staying to close, it was never part of how OT was
// computed anywhere in the app.
export function calcOvertimeHours(rec, stdHours) {
  if (!rec.inTime || !rec.outTime) return 0
  const raw = calcRawHrs(rec.inTime, rec.outTime)
  const deduct = rec.leaveType ? findLeaveType(rec.leaveType)?.deduct || 0 : 0
  const net = Math.max(0, raw - deduct)
  return Math.max(0, net - stdHours)
}

// True when a Day Shift/no-shift punch was too late to ever complete stdHours before
// the work window closes, even though the employee stayed through to the window's
// close — the exact case calcStatus above deliberately keeps as Present rather than
// demoting to Half Day/Absent. Surfaced separately (Reports.jsx Exceptions sheet,
// AttendanceGrid) so admin/HR can still see it without it affecting the stored status.
export function hasIncompleteHoursFlag(rec, stdHours) {
  if (!rec.inTime || !rec.outTime || rec.leaveType) return false
  const available = windowAvailableHours(rec.inTime)
  if (available == null || available >= stdHours) return false
  const raw = calcRawHrs(rec.inTime, rec.outTime)
  return raw >= available
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

// Duplicate-tap guard (plan.md P3-8) — client-side half. `lastPunchAtMs` is when this
// tab last completed a punch of the same type; if that was recent, a second tap is
// almost certainly the same physical tap landing twice, so it's rejected without a
// round trip. `employee_punch` in 0005_field_staff_and_geo.sql carries the real
// backstop against the actual DB state ("server decides, not the phone", §8C) — this
// is just the fast local check, not the source of truth.
export function isWithinCooldown(lastPunchAtMs, nowMs, cooldownMs) {
  if (lastPunchAtMs == null) return false
  return nowMs - lastPunchAtMs < cooldownMs
}
