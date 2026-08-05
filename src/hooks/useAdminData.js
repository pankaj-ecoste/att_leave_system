import { useState, useEffect, useCallback } from 'react'
import {
  adminFetchEmployees, adminCreateEmployee as apiCreateEmployee, adminUpdateEmployee as apiUpdateEmployee,
  adminToggleEmployeeStatus as apiToggleEmployeeStatus, adminDeleteEmployee as apiDeleteEmployee,
  adminSetEmploymentStatus as apiSetEmploymentStatus,
} from '../api/employees'
import {
  adminFetchLeaves, adminDecideLeave as apiDecideLeave, adminFetchLeaveBalances,
  adminUpsertLeaveBalance as apiUpsertLeaveBalance, adminBulkUpsertLeaveBalances as apiBulkUpsertLeaveBalances,
  adminResetLeaveBalances as apiResetLeaveBalances,
} from '../api/leave'
import { adminGetRegularizations, adminDecideRegularization as apiDecideRegularization } from '../api/attendance'
import { adminFetchAuditLogs, adminUpdateSettings as apiUpdateSettings, fetchHolidays, adminAddHoliday as apiAddHoliday, adminDeleteHoliday as apiDeleteHoliday } from '../api/admin'

// Everything an admin session needs that ISN'T attendance (see useAdminAttendance for
// why that one is separate) — employees, leave applications + balances, audit log,
// regularizations and holidays. Loaded once on admin login; each is a bounded dataset
// at the current ~300-employee scale (leave apps ~7,800/year, balances ~2,400 rows).
//
// stdHours is NOT owned here — it's a single global setting (app_settings.std_hours)
// that useAuth already loads once at bootstrap for both roles. Keeping a second copy
// here would be exactly the "one name, two things" duplication that broke the old app.
export function useAdminData(token, stdHours, onStdHoursChange) {
  const [employees, setEmployees] = useState([])
  const [leaves, setLeaves] = useState([])
  const [leaveBalances, setLeaveBalances] = useState({})
  const [auditLogs, setAuditLogs] = useState([])
  const [adminRegs, setAdminRegs] = useState([])
  const [holidays, setHolidays] = useState([])

  useEffect(() => {
    if (!token) {
      setEmployees([]); setLeaves([]); setLeaveBalances({}); setAuditLogs([]); setAdminRegs([]); setHolidays([])
      return
    }
    ;(async () => {
      try {
        const [emps, lvs, lb, logs, regs, hols] = await Promise.all([
          adminFetchEmployees(token),
          adminFetchLeaves(token, { limit: 2000 }),
          adminFetchLeaveBalances(token, { limit: 3000 }),
          adminFetchAuditLogs(token, 500),
          adminGetRegularizations(token),
          fetchHolidays(),
        ])
        setEmployees(emps); setLeaves(lvs); setLeaveBalances(lb); setAuditLogs(logs); setAdminRegs(regs); setHolidays(hols)
      } catch (err) {
        console.error(err)
      }
    })()
  }, [token])

  const refreshLeaveBalances = useCallback(async () => {
    setLeaveBalances(await adminFetchLeaveBalances(token, { limit: 3000 }))
  }, [token])

  // --- Employees ---
  async function createEmployee(form) {
    const created = await apiCreateEmployee(token, form)
    setEmployees(prev => [...prev, created])
    return created
  }
  async function updateEmployee(id, form) {
    const updated = await apiUpdateEmployee(token, id, form)
    setEmployees(prev => prev.map(e => (e.id === id ? updated : e)))
    return updated
  }
  async function setEmploymentStatus(id, status, probationEndDate) {
    const updated = await apiSetEmploymentStatus(token, id, status, probationEndDate)
    setEmployees(prev => prev.map(e => (e.id === id ? updated : e)))
    return updated
  }
  async function toggleEmployeeStatus(id) {
    const updated = await apiToggleEmployeeStatus(token, id)
    setEmployees(prev => prev.map(e => (e.id === id ? updated : e)))
    return updated
  }
  async function deleteEmployee(id) {
    await apiDeleteEmployee(token, id)
    setEmployees(prev => prev.filter(e => e.id !== id))
  }

  // --- Leaves ---
  async function decideLeave(id, decision) {
    const updated = await apiDecideLeave(token, id, decision)
    setLeaves(prev => prev.map(l => (l.id === id ? updated : l)))
    return updated
  }
  async function upsertLeaveBalance(empId, leaveType, values) {
    await apiUpsertLeaveBalance(token, empId, leaveType, values)
    await refreshLeaveBalances()
  }
  async function bulkUpsertLeaveBalances(records) {
    await apiBulkUpsertLeaveBalances(token, records)
    await refreshLeaveBalances()
  }
  async function resetLeaveBalancesForNewFY() {
    const count = await apiResetLeaveBalances(token)
    await refreshLeaveBalances()
    return count
  }

  // --- Regularizations ---
  async function decideRegularization(id, status) {
    const updated = await apiDecideRegularization(token, id, status)
    setAdminRegs(prev => prev.map(r => (r.id === id ? { ...r, status } : r)))
    return updated
  }

  // --- Settings / holidays ---
  async function updateSettings(newStdHours, newAdminPin) {
    await apiUpdateSettings(token, newStdHours, newAdminPin || null)
    onStdHoursChange?.(newStdHours)
  }
  async function addHoliday(date, name, type) {
    const h = await apiAddHoliday(token, date, name, type)
    setHolidays(prev => [...prev, h].sort((a, b) => (a.date < b.date ? -1 : 1)))
    return h
  }
  async function deleteHoliday(id) {
    await apiDeleteHoliday(token, id)
    setHolidays(prev => prev.filter(h => h.id !== id))
  }

  return {
    employees, setEmployees, leaves, leaveBalances, auditLogs, adminRegs, holidays, stdHours,
    createEmployee, updateEmployee, setEmploymentStatus, toggleEmployeeStatus, deleteEmployee,
    decideLeave, upsertLeaveBalance, bulkUpsertLeaveBalances, resetLeaveBalancesForNewFY, refreshLeaveBalances,
    decideRegularization, updateSettings, addHoliday, deleteHoliday,
  }
}
