import { describe, it, expect } from 'vitest'
import { isTimedLeaveType, validateTimedRequest, hhmm, timesLabel, awaitingApprovalLabel } from './requestTimes'

const base = { type: 'On Duty', date: '2026-11-10', today: '2026-11-10', inTime: '09:30', outTime: '18:30' }

describe('isTimedLeaveType', () => {
  it('is true only for On Duty and Work From Home', () => {
    expect(isTimedLeaveType('On Duty')).toBe(true)
    expect(isTimedLeaveType('Work From Home')).toBe(true)
    expect(isTimedLeaveType('Casual Leave')).toBe(false)
    expect(isTimedLeaveType('LOP')).toBe(false)
  })
})

describe('validateTimedRequest', () => {
  it('accepts today with both times in order', () => expect(validateTimedRequest(base)).toEqual({}))
  it('never complains about other leave types', () => {
    expect(validateTimedRequest({ ...base, type: 'Casual Leave', date: '2026-12-01', inTime: '', outTime: '' })).toEqual({})
  })
  it('refuses any day but today', () => {
    expect(validateTimedRequest({ ...base, date: '2026-11-11' }).date).toMatch(/only be applied for today/)
    expect(validateTimedRequest({ ...base, date: '2026-11-09' }).date).toMatch(/only be applied for today/)
  })
  it('needs both times', () => {
    expect(validateTimedRequest({ ...base, inTime: '' }).time).toMatch(/both/)
    expect(validateTimedRequest({ ...base, outTime: '' }).time).toMatch(/both/)
    expect(validateTimedRequest({ ...base, inTime: '', outTime: '' }).time).toMatch(/both/)
  })
  it('needs out after in', () => {
    expect(validateTimedRequest({ ...base, inTime: '18:00', outTime: '09:00' }).time).toMatch(/after in-time/)
    expect(validateTimedRequest({ ...base, inTime: '09:00', outTime: '09:00' }).time).toMatch(/after in-time/)
  })
})

describe('hhmm / timesLabel', () => {
  it('drops the seconds', () => expect(hhmm('09:30:00')).toBe('09:30'))
  it('is null for nothing', () => expect(hhmm(null)).toBeNull())
  it('builds the range', () => expect(timesLabel({ requestedIn: '09:30:00', requestedOut: '18:30:00' })).toBe('09:30 — 18:30'))
  it('is null for old rows / other leave types (no times)', () => {
    expect(timesLabel({ requestedIn: null, requestedOut: null })).toBeNull()
    expect(timesLabel({})).toBeNull()
    expect(timesLabel(undefined)).toBeNull()
  })
})

describe('awaitingApprovalLabel', () => {
  it('names who the request is waiting on', () => {
    expect(awaitingApprovalLabel({ leaveType: 'On Duty', status: 'Pending' }, true)).toBe('Awaiting manager approval')
    expect(awaitingApprovalLabel({ leaveType: 'Work From Home', status: 'Pending' }, false)).toBe('Awaiting admin approval')
  })
  it('is nothing once decided, or for other leave types', () => {
    expect(awaitingApprovalLabel({ leaveType: 'On Duty', status: 'Approved' }, true)).toBeNull()
    expect(awaitingApprovalLabel({ leaveType: 'On Duty', status: 'Rejected' }, true)).toBeNull()
    expect(awaitingApprovalLabel({ leaveType: 'Casual Leave', status: 'Pending' }, true)).toBeNull()
    expect(awaitingApprovalLabel(null, true)).toBeNull()
  })
})
