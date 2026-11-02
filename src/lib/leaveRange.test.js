import { describe, it, expect } from 'vitest'
import { daysInRange, hasWaitingRequest, rangeLabel } from './leaveRange'

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
