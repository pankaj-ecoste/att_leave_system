// These cover the calculations flagged in plan.md §8C as "the ones that quietly
// corrupt payroll if wrong" — not broad coverage, just the load-bearing math.

import { describe, it, expect } from 'vitest'
import { calcRawHrs, calcStatus, calcOvertimeHours, hasIncompleteHoursFlag, financialYearFor, monthsOfServiceSince, isWithinCooldown, todayIST, daysFromTodayIST } from './datetime'
import { DAY_TYPES } from './constants'

describe('calcRawHrs', () => {
  it('computes a normal same-day shift', () => {
    expect(calcRawHrs('09:00', '18:00')).toBe(9)
  })

  it('handles an overnight shift instead of clamping to zero', () => {
    // The old bug: 06:00 - 21:00 = -15h -> clamped to 0 -> always "Absent".
    expect(calcRawHrs('21:00', '06:00')).toBe(9)
  })

  it('handles a shift crossing midnight by a few minutes', () => {
    expect(calcRawHrs('23:50', '00:10')).toBeCloseTo(1 / 3, 5)
  })

  it('returns 0 when either punch is missing', () => {
    expect(calcRawHrs(null, '18:00')).toBe(0)
    expect(calcRawHrs('09:00', null)).toBe(0)
  })
})

describe('calcStatus', () => {
  const stdHours = 9

  it('marks a full day as Present', () => {
    expect(calcStatus({ inTime: '09:00', outTime: '18:00' }, stdHours)).toBe('Present')
  })

  it('marks a night shift worked in full as Present, not Absent', () => {
    expect(calcStatus({ inTime: '21:00', outTime: '06:00' }, stdHours)).toBe('Present')
  })

  it('uses stdHours / 2 as the half-day threshold, not a hardcoded 4.5', () => {
    // stdHours=8 -> threshold 4h. 4.2h worked should be Half Day even though the old
    // hardcoded 4.5h threshold would have called it Absent.
    expect(calcStatus({ inTime: '09:00', outTime: '13:12' }, 8)).toBe('Half Day')
  })

  it('marks under-threshold hours as Absent', () => {
    expect(calcStatus({ inTime: '09:00', outTime: '11:00' }, stdHours)).toBe('Absent')
  })

  it('marks a punched-in-but-not-out employee as Punched In, not Absent', () => {
    // Regression for plan.md §12 V3 decision 2 — an employee mid-shift with no
    // out-punch yet used to fall through to calcRawHrs treating the missing out-time as
    // 0 hours, which read as Absent despite having clearly shown up.
    expect(calcStatus({ inTime: '09:00', outTime: null }, stdHours)).toBe('Punched In')
  })

  it('does not count an unpunched week-off as Absent', () => {
    expect(calcStatus({ inTime: null }, stdHours, DAY_TYPES.WEEK_OFF)).toBe('Week Off')
  })

  it('does not count an unpunched holiday as Absent', () => {
    expect(calcStatus({ inTime: null }, stdHours, DAY_TYPES.HOLIDAY)).toBe('Holiday')
  })

  it('still counts an unpunched ordinary working day as Absent', () => {
    expect(calcStatus({ inTime: null }, stdHours, DAY_TYPES.WORKING)).toBe('Absent')
  })

  it('leave type marked present=false yields Leave regardless of day type', () => {
    expect(calcStatus({ leaveType: 'Sick Leave' }, stdHours, DAY_TYPES.WORKING)).toBe('Leave')
  })

  it('Work From Home and On Duty count as present-type statuses', () => {
    expect(calcStatus({ leaveType: 'Work From Home' }, stdHours)).toBe('WFH')
    expect(calcStatus({ leaveType: 'On Duty' }, stdHours)).toBe('On Duty')
  })

  it('a half-day leave yields Half Day Leave, not plain Leave', () => {
    expect(calcStatus({ leaveType: 'Casual Leave', dayPart: 'first_half' }, stdHours)).toBe('Half Day Leave')
    expect(calcStatus({ leaveType: 'Sick Leave', dayPart: 'second_half' }, stdHours)).toBe('Half Day Leave')
  })

  it('a full-day leave still yields plain Leave even with dayPart="full"', () => {
    expect(calcStatus({ leaveType: 'Casual Leave', dayPart: 'full' }, stdHours)).toBe('Leave')
  })

  describe('flexible work window (9:00-19:00)', () => {
    it('a 10:00 punch-in exactly reaching stdHours at the window close is Present', () => {
      // 10:00 -> 19:00 is exactly stdHours=9, the latest on-time punch-in.
      expect(calcStatus({ inTime: '10:00', outTime: '19:00' }, stdHours)).toBe('Present')
    })

    it('hours worked past the window close are not counted, but do not demote an on-time punch-in', () => {
      // 9:00 -> 20:00 = 11h raw, but only 9:00-19:00 (10h) is inside the window, and
      // that already clears stdHours=9 — still Present.
      expect(calcStatus({ inTime: '09:00', outTime: '20:00' }, stdHours)).toBe('Present')
    })

    it('a late punch-in that stays through the window close is Present despite falling short of stdHours', () => {
      // 15:00 -> 22:00 = 7h raw, but only 15:00-19:00 (4h) is inside the window. Old
      // logic would call 7h a Half Day; capped to 4h it would be Absent. Since they
      // stayed through 19:00 (used every minute available), it's forgiven to Present.
      expect(calcStatus({ inTime: '15:00', outTime: '22:00' }, stdHours)).toBe('Present')
    })

    it('a late punch-in that also leaves early (before the window closes) still falls to Absent', () => {
      // 15:00 -> 17:00 = 2h, and they left 2h before the 19:00 window close — the
      // shortfall isn't purely the window's fault, so the normal threshold applies.
      expect(calcStatus({ inTime: '15:00', outTime: '17:00' }, stdHours)).toBe('Absent')
    })

    it('Night Shift punch-ins (at/after the window close) are unaffected by the window rule', () => {
      // Already covered by the "night shift worked in full" test above (21:00-06:00 ->
      // Present); this checks a Night Shift shortfall still uses the plain calculation.
      expect(calcStatus({ inTime: '21:00', outTime: '23:00' }, stdHours)).toBe('Absent')
    })
  })
})

describe('calcOvertimeHours', () => {
  const stdHours = 9

  it('is 0 when hours worked do not exceed stdHours', () => {
    expect(calcOvertimeHours({ inTime: '09:00', outTime: '18:00' }, stdHours)).toBe(0)
  })

  it('returns the hours worked past stdHours', () => {
    expect(calcOvertimeHours({ inTime: '09:00', outTime: '20:00' }, stdHours)).toBe(2)
  })

  it('handles an overnight shift the same as calcRawHrs (wraps past midnight)', () => {
    expect(calcOvertimeHours({ inTime: '21:00', outTime: '09:00' }, stdHours)).toBe(3)
  })

  it('is 0 when either punch is missing', () => {
    expect(calcOvertimeHours({ inTime: '09:00', outTime: null }, stdHours)).toBe(0)
    expect(calcOvertimeHours({ inTime: null, outTime: '20:00' }, stdHours)).toBe(0)
  })

  it('subtracts a partial-leave deduction before comparing to stdHours, matching calcStatus', () => {
    // Partial Leave - 1 Hour has deduct: 1 (plan.md constants.js). 9:00-19:00 is 10h
    // raw, minus 1h deduction = 9h net = exactly stdHours, so no OT yet.
    expect(calcOvertimeHours({ inTime: '09:00', outTime: '19:00', leaveType: 'Partial Leave - 1 Hour' }, stdHours)).toBe(0)
    // One more hour worked now clears stdHours after the deduction.
    expect(calcOvertimeHours({ inTime: '09:00', outTime: '20:00', leaveType: 'Partial Leave - 1 Hour' }, stdHours)).toBe(1)
  })
})

describe('hasIncompleteHoursFlag', () => {
  const stdHours = 9

  it('flags a late punch-in that stayed through the window close but still fell short', () => {
    expect(hasIncompleteHoursFlag({ inTime: '15:00', outTime: '22:00' }, stdHours)).toBe(true)
  })

  it('does not flag an on-time punch-in that reached stdHours', () => {
    expect(hasIncompleteHoursFlag({ inTime: '09:00', outTime: '18:00' }, stdHours)).toBe(false)
  })

  it('does not flag a late punch-in that also left early — that case is Absent, not a flag', () => {
    expect(hasIncompleteHoursFlag({ inTime: '15:00', outTime: '17:00' }, stdHours)).toBe(false)
  })

  it('does not flag Night Shift punches', () => {
    expect(hasIncompleteHoursFlag({ inTime: '21:00', outTime: '23:00' }, stdHours)).toBe(false)
  })

  it('does not flag a leave day', () => {
    expect(hasIncompleteHoursFlag({ inTime: '15:00', outTime: '22:00', leaveType: 'Casual Leave' }, stdHours)).toBe(false)
  })
})

describe('financialYearFor', () => {
  it('treats Jan-Mar as part of the previous FY', () => {
    expect(financialYearFor('2026-03-31')).toBe(2025)
  })

  it('treats Apr-Dec as the start of the current FY', () => {
    expect(financialYearFor('2026-04-01')).toBe(2026)
  })

  it('handles the exact IST-midnight boundary date correctly', () => {
    expect(financialYearFor('2026-01-01')).toBe(2025)
  })
})

describe('monthsOfServiceSince', () => {
  it('counts only whole months', () => {
    expect(monthsOfServiceSince('2026-01-15', '2026-04-14')).toBe(2)
    expect(monthsOfServiceSince('2026-01-15', '2026-04-15')).toBe(3)
  })

  it('returns 0 for a joining date with no full month yet', () => {
    expect(monthsOfServiceSince('2026-04-01', '2026-04-20')).toBe(0)
  })

  it('returns 0 when there is no joining date', () => {
    expect(monthsOfServiceSince(null, '2026-04-20')).toBe(0)
  })
})

describe('daysFromTodayIST', () => {
  it('0 days out equals todayIST', () => {
    expect(daysFromTodayIST(0)).toBe(todayIST())
  })

  it('advances the calendar date by the given number of days', () => {
    const today = new Date(todayIST() + 'T00:00:00Z')
    const expected = new Date(today)
    expected.setUTCDate(expected.getUTCDate() + 7)
    const expectedStr = `${expected.getUTCFullYear()}-${String(expected.getUTCMonth() + 1).padStart(2, '0')}-${String(expected.getUTCDate()).padStart(2, '0')}`
    expect(daysFromTodayIST(7)).toBe(expectedStr)
  })
})

describe('isWithinCooldown', () => {
  it('is not on cooldown when there is no prior punch', () => {
    expect(isWithinCooldown(null, Date.now(), 30000)).toBe(false)
  })

  it('flags a repeat within the cooldown window', () => {
    const last = 1000
    expect(isWithinCooldown(last, last + 5000, 30000)).toBe(true)
  })

  it('clears once the cooldown window has passed', () => {
    const last = 1000
    expect(isWithinCooldown(last, last + 30001, 30000)).toBe(false)
  })

  it('is exclusive at the exact boundary', () => {
    const last = 1000
    expect(isWithinCooldown(last, last + 30000, 30000)).toBe(false)
  })
})
