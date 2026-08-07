// Every rule value the app enforces lives here — never typed inline elsewhere (G-3,
// plan.md §8C). The old app hardcoded the half-day threshold as 4.5 in one place while
// its own settings screen promised "std hours ÷ 2"; that's the bug this rule exists to
// prevent.

export const COMPANIES = [
  'Asma Traexim Pvt Ltd',
  'Metamask Design Solutions LLP',
  'Lamora Buildtech Pvt Ltd',
]
export const COMPANY_COLORS = [
  'from-violet-600 to-indigo-600',
  'from-cyan-600 to-blue-600',
  'from-emerald-600 to-teal-600',
]
export const COMPANY_ICONS = ['A', 'M', 'L']

export const LEAVE_TYPES = [
  { label: 'Sick Leave', deduct: 0, present: false, max: null, icon: 'SL' },
  { label: 'Casual Leave', deduct: 0, present: false, max: null, icon: 'CL' },
  { label: 'Earned Leave', deduct: 0, present: false, max: null, icon: 'EL' },
  { label: 'LOP', deduct: 0, present: false, max: null, icon: 'LOP' },
  { label: 'Bereavement Leave', deduct: 0, present: false, max: null, icon: 'BL' },
  { label: 'Marriage Leave', deduct: 0, present: false, max: null, icon: 'ML' },
  { label: 'Maternity Leave', deduct: 0, present: false, max: null, icon: 'MT' },
  { label: 'Paternity Leave', deduct: 0, present: false, max: null, icon: 'PT' },
  { label: 'Partial Leave - 1 Hour', deduct: 1, present: true, max: 2, icon: 'P1' },
  { label: 'Partial Leave - 2 Hours', deduct: 2, present: true, max: 1, icon: 'P2' },
  { label: 'Work From Home', deduct: 0, present: true, max: null, icon: 'WH' },
  { label: 'On Duty', deduct: 0, present: true, max: null, icon: 'OD' },
]

export function findLeaveType(label) {
  return LEAVE_TYPES.find(l => l.label === label) || null
}

export const SHIFTS = [
  { id: 'day', label: 'Day Shift', start: '09:00', end: '18:00', color: '#f59e0b' },
  { id: 'night', label: 'Night Shift', start: '21:00', end: '06:00', color: '#818cf8' },
  { id: 'both', label: 'Both Shifts', start: '', end: '', color: '#10b981' },
  { id: 'none', label: 'No Shift', start: '', end: '', color: '#64748b' },
]

export function findShift(id) {
  return SHIFTS.find(s => s.id === id) || null
}

// Falls back through: the employee's configured shift -> a shift name recorded on the
// attendance row itself (from biometric imports) -> a guess from the punch-in hour ->
// "No Shift". Order matters: the employee's own setting should always win when present.
export function getShiftInfo(rec, emp) {
  if (emp?.shiftType && emp.shiftType !== 'none') {
    const s = findShift(emp.shiftType)
    if (s) return s
  }
  if (rec?.shift) {
    const sl = rec.shift.toLowerCase()
    if (sl.includes('night') || sl.includes('n-') || sl === 'n') return SHIFTS[1]
    if (sl.includes('day') || sl.includes('d-') || sl === 'd') return SHIFTS[0]
    if (sl.includes('both') || sl.includes('general')) return SHIFTS[2]
  }
  if (rec?.inTime) {
    const h = parseInt(rec.inTime.split(':')[0], 10)
    if (h >= 18 || h < 6) return SHIFTS[1]
    return SHIFTS[0]
  }
  return SHIFTS[3]
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// attendance.day_type — the single source of truth for what kind of calendar day a row
// represents (plan.md §8B S-2c). Replaces the old ignored `week_off` boolean.
export const DAY_TYPES = { WORKING: 'working', WEEK_OFF: 'week_off', HOLIDAY: 'holiday' }

export const EMPLOYMENT_STATUSES = ['Probation', 'Confirmed', 'Notice Period', 'Exited']

// OS / FS / WFH (plan.md §6B) — the tag admin sets per employee at creation, driving
// which punch tiles they see. 'office' matches the employees.work_mode column default.
// 'both' (Office + Field) is a fourth, non-abbreviated combination: office tiles plus
// the Field tile, for staff who genuinely split between the two — field staff are
// exempt from the office geofence check on the Field tile but must write a structured
// note instead (Decision 4). 'wfh' is *permanent* remote, not the occasional
// WFH leave type (unrelated, unchanged — see requiresFieldNote below and §6B).
export const WORK_MODES = [
  { id: 'office', label: 'Office (OS)' },
  { id: 'field', label: 'Field (FS)' },
  { id: 'both', label: 'Office + Field' },
  { id: 'wfh', label: 'WFH' },
]

export function findWorkMode(id) {
  return WORK_MODES.find(w => w.id === id) || WORK_MODES[0]
}

// A field-mode employee must write a note (where they are / where they're going,
// plan.md Decision 4) before a punch is accepted, since they don't get the office
// geofence check once it lands.
export function requiresFieldNote(workMode) {
  return workMode === 'field' || workMode === 'both'
}

// GPS quality (P3-7) — request a high-accuracy reading and retry a few times rather
// than silently accepting the first (possibly very poor) fix. Real coordinate storage
// and server-side rejection land with the `sites` table (P3-1/P3-2); until then this
// only shapes what the employee sees.
export const ACCEPTABLE_GPS_ACCURACY_M = 100
export const GPS_RETRY_ATTEMPTS = 3

// App-vs-biometric mismatch flag (P3-11) — readings within this many minutes of each
// other are treated as agreeing (clocks/devices are rarely perfectly in sync).
export const APP_BIO_MISMATCH_THRESHOLD_MIN = 5

// Duplicate-tap guard (P3-8). Mirrored server-side in employee_punch's cooldown check
// (supabase/migrations/0005_field_staff_and_geo.sql) — keep both in sync if this changes.
export const PUNCH_COOLDOWN_MS = 30000

// Leave policy quotas (plan.md §6A) — CL 12 / EL 6 / SL 4 per year, credited in full on
// 1 April, pro-rated for part-year joiners. Used by both the balance-generation script
// (Stage G) and the Day 3 accrual engine.
export const LEAVE_POLICY = {
  CASUAL: { label: 'Casual Leave', perYear: 12, proRataPerMonth: 1 },
  EARNED: { label: 'Earned Leave', perYear: 6, proRataPerMonth: 0.5 },
  SICK: { label: 'Sick Leave', perYear: 4, proRataPerMonth: null }, // not pro-rated per policy
}

// Leave year runs 1 April -> 31 March.
export const FINANCIAL_YEAR_START_MONTH = 4

// Flexible-shift work window (Day Shift / no-shift staff only — Night Shift punches
// in well outside this window and is deliberately left on the plain calcRawHrs
// calculation, see calcStatus). Staff can punch in any time, but stdHours must be
// completed inside this window: a 9:00 punch-in still has the full window to reach
// stdHours (9:00-18:00 already gets there); a 10:00 punch-in's window ends exactly at
// stdHours later; any later than that and stdHours can no longer fit before the window
// closes.
export const WORK_WINDOW_START = '09:00'
export const WORK_WINDOW_END = '19:00'

export const ABSENT_STATUS = 'Absent'
export const PRESENT_STATUS = 'Present'
export const HALF_DAY_STATUS = 'Half Day'
export const LEAVE_STATUS = 'Leave'
export const HALF_DAY_LEAVE_STATUS = 'Half Day Leave'
export const WFH_STATUS = 'WFH'
export const ON_DUTY_STATUS = 'On Duty'
export const WEEK_OFF_STATUS = 'Week Off'
export const HOLIDAY_STATUS = 'Holiday'

// Half-day leave (plan.md Day 3, P4B-2) — only the three quota-tracked types can be
// split into a half day; the policy doc only ever says this for CL/EL, Sick Leave was
// already folded in by an earlier decision (PROGRESS.md P4B-2).
export const HALF_DAY_ELIGIBLE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave']

export const DAY_PARTS = [
  { id: 'full', label: 'Full Day' },
  { id: 'first_half', label: 'First Half' },
  { id: 'second_half', label: 'Second Half' },
]

// P4-6 (revised) — no DNS/Resend transactional email; the employee's own mail client
// sends a nudge to the manager + admin instead, with a link back into the app.
export const APP_URL = 'https://att-leave-system.vercel.app'
