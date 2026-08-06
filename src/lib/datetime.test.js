// These cover the calculations flagged in plan.md §8C as "the ones that quietly
// corrupt payroll if wrong" — not broad coverage, just the load-bearing math.

import { describe, it, expect } from 'vitest'
import { calcRawHrs, calcStatus, financialYearFor, monthsOfServiceSince, isWithinCooldown } from './datetime'
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
