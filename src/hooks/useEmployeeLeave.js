import { useState, useEffect } from 'react'
import { employeeFetchLeaves, employeeApplyLeave, employeeFetchLeaveBalances } from '../api/leave'
import { employeeSubmitRegularization, employeeGetRegularizations } from '../api/attendance'
import { LEAVE_TYPES } from '../lib/constants'
import { todayIST } from '../lib/datetime'

export function useEmployeeLeave(token, empId, onAudit) {
  const [leaves, setLeaves] = useState([])
  const [leaveBalances, setLeaveBalances] = useState({})
  const [regularizations, setRegularizations] = useState([])

  useEffect(() => {
    if (!token || !empId) {
      setLeaves([]); setLeaveBalances({}); setRegularizations([])
      return
    }
    Promise.all([
      employeeFetchLeaves(token, empId),
      employeeFetchLeaveBalances(token, empId),
      employeeGetRegularizations(token, empId),
    ]).then(([lvs, lb, regs]) => {
      setLeaves(lvs)
      setLeaveBalances(lb)
      setRegularizations(regs)
    }).catch(console.error)
  }, [token, empId])

  // A leave type is only offered while its monthly usage (Partial 1hr/2hr, capped per
  // policy) hasn't hit its cap yet — plan.md §6A / Appendix leave types list.
  function availableLeaveTypes() {
    const m = new Date().getMonth() + 1
    const y = new Date().getFullYear()
    const usedThisMonth = type => leaves.filter(l =>
      l.empId === empId && l.leaveType === type && l.status !== 'Rejected' &&
      new Date(l.date).getMonth() + 1 === m && new Date(l.date).getFullYear() === y
    ).length
    return LEAVE_TYPES.filter(lt => !lt.max || usedThisMonth(lt.label) < lt.max)
  }

  async function applyLeave(currentUser, form) {
    const saved = await employeeApplyLeave(token, empId, {
      empName: currentUser.name,
      company: currentUser.company,
      leaveType: form.type,
      date: form.date,
      reason: form.reason,
      location: form.location || null,
    })
    if (saved) setLeaves(prev => [saved, ...prev])
    onAudit?.('LEAVE_APPLY', `${currentUser.name} applied ${form.type} on ${form.date}`, currentUser.name)
    return saved
  }

  async function submitRegularization(currentUser, form) {
    const saved = await employeeSubmitRegularization(token, empId, form.date, form.inTime || null, form.outTime || null, form.reason)
    setRegularizations(prev => [saved, ...prev])
    onAudit?.('REGULARIZATION', `${currentUser.name} requested regularization for ${form.date}`, currentUser.name)
    return saved
  }

  return { leaves, leaveBalances, regularizations, availableLeaveTypes, applyLeave, submitRegularization }
}
