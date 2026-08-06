import { supabase } from '../lib/supabase'
import { rowToLeave, rowToLeaveBalance } from './mappers'

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export async function employeeFetchLeaves(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_leaves', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  return (data || []).map(rowToLeave)
}

export async function employeeApplyLeave(token, empId, leave) {
  const { data, error } = await supabase.rpc('employee_apply_leave', {
    p_token: token,
    p_emp_id: empId,
    p_data: {
      emp_name: leave.empName,
      company: leave.company,
      leave_type: leave.leaveType,
      date: leave.date,
      day_part: leave.dayPart || 'full',
      reason: leave.reason,
      location: leave.location || null,
      document_path: leave.documentPath || null,
    },
  })
  if (error) throw error
  return rowToLeave(data)
}

function leaveBalanceMap(rows) {
  const map = {}
  for (const row of rows || []) {
    const lb = rowToLeaveBalance(row)
    if (!map[lb.empId]) map[lb.empId] = {}
    map[lb.empId][lb.leaveType] = lb
  }
  return map
}

export async function employeeFetchLeaveBalances(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_leave_balances', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  return leaveBalanceMap(data)
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export async function managerGetTeamLeaves(token, managerId) {
  const { data, error } = await supabase.rpc('manager_get_team_leaves', {
    p_token: token,
    p_manager_id: managerId,
  })
  if (error) throw error
  return (data || []).map(rowToLeave)
}

export async function managerDecideLeave(token, managerId, leaveId, status) {
  const { data, error } = await supabase.rpc('manager_decide_leave', {
    p_token: token,
    p_manager_id: managerId,
    p_leave_id: leaveId,
    p_status: status,
  })
  if (error) throw error
  return rowToLeave(data)
}

// ---------------------------------------------------------------------------
// Admin — paginated per plan.md §8B (old admin_get_all_leaves returned every row)
// ---------------------------------------------------------------------------

export async function adminFetchLeaves(token, { status, from, to, limit = 500, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('admin_get_leaves', {
    p_token: token,
    p_status: status || null,
    p_from: from || null,
    p_to: to || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data || []).map(rowToLeave)
}

export async function adminDecideLeave(token, leaveId, decision) {
  const { data, error } = await supabase.rpc('admin_decide_leave', {
    p_token: token,
    p_leave_id: leaveId,
    p_decision: decision,
  })
  if (error) throw error
  return rowToLeave(data)
}

export async function adminFetchLeaveBalances(token, { financialYear, limit = 1000, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('admin_get_leave_balances', {
    p_token: token,
    p_financial_year: financialYear || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return leaveBalanceMap(data)
}

export async function adminUpsertLeaveBalance(token, empId, leaveType, values) {
  const { error } = await supabase.rpc('admin_upsert_leave_balance', {
    p_token: token,
    p_emp_id: empId,
    p_leave_type: leaveType,
    p_accrued: values.accrued,
    p_consumed: values.consumed,
    p_balance: values.balance,
    p_quota: values.quota,
    p_unit: values.unit,
  })
  if (error) throw error
}

export async function adminBulkUpsertLeaveBalances(token, records) {
  const payload = records.map(r => ({
    emp_id: r.empId,
    leave_type: r.leaveType,
    accrued: r.accrued,
    consumed: r.consumed,
    balance: r.balance,
    quota: r.quota,
    unit: r.unit,
  }))
  const { data, error } = await supabase.rpc('admin_bulk_upsert_leave_balances', {
    p_token: token,
    p_records: payload,
  })
  if (error) throw error
  return data // number of rows written
}

export async function adminResetLeaveBalances(token) {
  const { data, error } = await supabase.rpc('admin_reset_leave_balances', { p_token: token })
  if (error) throw error
  return data // number of rows created
}
