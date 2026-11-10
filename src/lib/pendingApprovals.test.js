import { describe, it, expect } from 'vitest'
import { countPendingApprovals, pendingApprovalsText, titleWithCount } from './pendingApprovals'

describe('countPendingApprovals', () => {
  it('is zero for nothing', () => {
    expect(countPendingApprovals([], [])).toEqual({ leaves: 0, onDuty: 0, wfh: 0, regs: 0, total: 0 })
    expect(countPendingApprovals(undefined, undefined).total).toBe(0)
  })
  it('counts only Pending, not decided or already-manager-approved items', () => {
    const leaves = [{ status: 'Pending' }, { status: 'Manager Approved' }, { status: 'Approved' }, { status: 'Rejected' }, { status: 'Pending' }]
    const regs = [{ status: 'Pending' }, { status: 'Approved' }, { status: 'Rejected' }]
    expect(countPendingApprovals(leaves, regs)).toEqual({ leaves: 2, onDuty: 0, wfh: 0, regs: 1, total: 3 })
  })
  it('counts On Duty and WFH on their own, inside the same total (plan.md §60)', () => {
    const leaves = [
      { status: 'Pending', leaveType: 'On Duty' }, { status: 'Pending', leaveType: 'Work From Home' },
      { status: 'Pending', leaveType: 'Casual Leave' }, { status: 'Approved', leaveType: 'On Duty' },
    ]
    expect(countPendingApprovals(leaves, [{ status: 'Pending' }])).toEqual({ leaves: 1, onDuty: 1, wfh: 1, regs: 1, total: 4 })
  })
  it('survives junk rows', () => {
    expect(countPendingApprovals([null, {}], [undefined]).total).toBe(0)
  })
})

describe('pendingApprovalsText', () => {
  it('says nothing when nothing is waiting', () => {
    expect(pendingApprovalsText({ leaves: 0, onDuty: 0, wfh: 0, regs: 0, total: 0 })).toBeNull()
  })
  it('uses singular for one request', () => {
    expect(pendingApprovalsText({ leaves: 1, onDuty: 0, wfh: 0, regs: 0, total: 1 })).toBe('1 request waiting for your approval (1 leave)')
  })
  it('lists both kinds', () => {
    expect(pendingApprovalsText({ leaves: 2, onDuty: 0, wfh: 0, regs: 1, total: 3 })).toBe('3 requests waiting for your approval (2 leave, 1 correction)')
  })
  it('lists only the kind that has items', () => {
    expect(pendingApprovalsText({ leaves: 0, onDuty: 0, wfh: 0, regs: 4, total: 4 })).toBe('4 requests waiting for your approval (4 correction)')
  })
  it('names On Duty and WFH first so a same-day request stands out (plan.md §60)', () => {
    expect(pendingApprovalsText({ leaves: 2, onDuty: 1, wfh: 1, regs: 1, total: 5 })).toBe('5 requests waiting for your approval (1 On Duty, 1 WFH, 2 leave, 1 correction)')
  })
})

describe('titleWithCount', () => {
  it('prefixes the count', () => expect(titleWithCount('HRMS', 3)).toBe('(3) HRMS'))
  it('restores the plain title at zero', () => {
    expect(titleWithCount('HRMS', 0)).toBe('HRMS')
    expect(titleWithCount('HRMS', undefined)).toBe('HRMS')
  })
})
