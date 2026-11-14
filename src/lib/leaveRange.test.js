import { describe, it, expect } from 'vitest'
import { daysInRange, hasWaitingRequest, rangeLabel, earliestLeaveDate, pastDayError } from './leaveRange'

describe('daysInRange', () => {
  it('lists every day and skips Sundays', () => {
    // 2026-11-20 is a Friday, 2026-11-23 a Monday
    expect(daysInRange('2026-11-20', '2026-11-23')).toEqual(['2026-11-20', '2026-11-21', '2026-11-23'])
  })
  it('one date (or no end date) is just that date, even a Sunday', () => {
    expect(daysInRange('2026-11-22', '')).toEqual(['2026-11-22'])
    expect(daysInRange('2026-11-22', '2026-11-22')).toEqual(['2026-11-22'])
  })
  it('bad or reversed input gives nothing', () => {
    expect(daysInRange('2026-11-23', '2026-11-20')).toEqual([])
    expect(daysInRange('', '')).toEqual([])
  })
})

describe('hasWaitingRequest', () => {
  const l = (o) => ({ empId: 'e1', leaveType: 'Casual Leave', status: 'Pending', date: '2026-11-10', ...o })
  it('true for a same-type pending request that has not passed', () => {
    expect(hasWaitingRequest([l()], 'e1', 'Casual Leave', '2026-11-02')).toBe(true)
    expect(hasWaitingRequest([l({ status: 'Manager Approved' })], 'e1', 'Casual Leave', '2026-11-02')).toBe(true)
  })
  it('false for other types, decided requests, other people, and old pending ones', () => {
    expect(hasWaitingRequest([l()], 'e1', 'Sick Leave', '2026-11-02')).toBe(false)
    expect(hasWaitingRequest([l({ status: 'Approved' })], 'e1', 'Casual Leave', '2026-11-02')).toBe(false)
    expect(hasWaitingRequest([l({ empId: 'e2' })], 'e1', 'Casual Leave', '2026-11-02')).toBe(false)
    expect(hasWaitingRequest([l({ date: '2026-10-01' })], 'e1', 'Casual Leave', '2026-11-02')).toBe(false)
  })
  it('LOP, Work From Home and On Duty never wait', () => {
    for (const t of ['LOP', 'Work From Home', 'On Duty']) expect(hasWaitingRequest([l({ leaveType: t })], 'e1', t, '2026-11-02')).toBe(false)
  })
})

describe('rangeLabel', () => {
  it('formats one day and several days', () => {
    expect(rangeLabel(['2026-11-03'])).toBe('2026-11-03')
    expect(rangeLabel(['2026-11-03', '2026-11-04', '2026-11-05'])).toBe('2026-11-03 to 2026-11-05')
    expect(rangeLabel([])).toBe('')
  })
})

describe('past-day leave window (plan.md §62)', () => {
  it('Casual, Earned and Sick start at the 1st of the current month', () => {
    for (const t of ['Casual Leave', 'Earned Leave', 'Sick Leave']) expect(earliestLeaveDate(t, '2026-11-14')).toBe('2026-11-01')
  })
  it('other types have no limit from this rule', () => {
    expect(earliestLeaveDate('Partial Leave - 1 Hour', '2026-11-14')).toBe('')
    expect(earliestLeaveDate('LOP', '2026-11-14')).toBe('')
  })
  it('flags a date before the 1st of the month, accepts the 1st, today and the future', () => {
    expect(pastDayError('Casual Leave', '2026-10-31', '2026-11-14')).not.toBe('')
    expect(pastDayError('Sick Leave', '2026-11-01', '2026-11-14')).toBe('')
    expect(pastDayError('Earned Leave', '2026-11-14', '2026-11-14')).toBe('')
    expect(pastDayError('Casual Leave', '2026-12-02', '2026-11-14')).toBe('')
    expect(pastDayError('LOP', '2026-10-01', '2026-11-14')).toBe('')
  })
})
