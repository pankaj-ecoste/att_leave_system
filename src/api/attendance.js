import { supabase } from '../lib/supabase'
import { rowToAttendance, attendanceToRow, attendanceToBulkRow, attnKey, rowToRegularization } from './mappers'

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

// p_from/p_to default to null (all rows) at the database level, but callers should
// pass a range in practice — plan.md §8B's one-month ceiling: the staff panel opens
// on the current month only, never the employee's whole history at once.
export async function employeeFetchAttendance(token, empId, { from, to } = {}) {
  const { data, error } = await supabase.rpc('employee_get_attendance', {
    p_token: token,
    p_emp_id: empId,
    p_from: from || null,
    p_to: to || null,
  })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const rec = rowToAttendance(row)
    map[attnKey(rec.empId, rec.date)] = rec
  }
  return map
}

export async function employeePunch(token, empId, record) {
  const { data, error } = await supabase.rpc('employee_punch', {
    p_token: token,
    p_emp_id: empId,
    p_data: attendanceToRow(record),
  })
  if (error) throw error
  return rowToAttendance(data)
}

// ---------------------------------------------------------------------------
// Admin — paginated per plan.md §8B (the old admin_get_all_attendance returned every
// row in the table with no limit; at 300 staff that's ~109,500 rows/year in one call).
// ---------------------------------------------------------------------------

export async function adminFetchAttendance(token, { from, to, company, empId, limit = 500, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('admin_get_attendance', {
    p_token: token,
    p_from: from || null,
    p_to: to || null,
    p_company: company || null,
    p_emp_id: empId || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const rec = rowToAttendance(row)
    map[attnKey(rec.empId, rec.date)] = rec
  }
  return map
}

export async function adminUpsertAttendance(token, empId, record) {
  const { data, error } = await supabase.rpc('admin_upsert_attendance', {
    p_token: token,
    p_emp_id: empId,
    p_data: attendanceToRow(record),
  })
  if (error) throw error
  return rowToAttendance(data)
}

// Used by the Daily Bio and Monthly Bio imports, which can touch hundreds or thousands
// of rows in one go — sending them all in a single RPC avoids hundreds of slow,
// sequential round trips.
export async function adminBulkUpsertAttendance(token, records) {
  const payload = records.map(attendanceToBulkRow)
  const { data, error } = await supabase.rpc('admin_bulk_upsert_attendance', {
    p_token: token,
    p_records: payload,
  })
  if (error) throw error
  return data // number of rows written
}

// ---------------------------------------------------------------------------
// Manager — team attendance, one month at a time (already scoped this way)
// ---------------------------------------------------------------------------

export async function managerGetTeamAttendance(token, managerId, month, year) {
  const { data, error } = await supabase.rpc('manager_get_team_attendance', {
    p_token: token,
    p_manager_id: managerId,
    p_month: month,
    p_year: year,
  })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const rec = rowToAttendance(row)
    map[attnKey(rec.empId, rec.date)] = rec
  }
  return map
}

// ---------------------------------------------------------------------------
// Regularizations (attendance corrections)
// ---------------------------------------------------------------------------

export async function employeeSubmitRegularization(token, empId, date, inTime, outTime, reason) {
  const { data, error } = await supabase.rpc('employee_submit_regularization', {
    p_token: token,
    p_emp_id: empId,
    p_date: date,
    p_in: inTime || null,
    p_out: outTime || null,
    p_reason: reason,
  })
  if (error) throw error
  return rowToRegularization(data)
}

export async function employeeGetRegularizations(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_regularizations', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  return (data || []).map(rowToRegularization)
}

export async function managerGetTeamRegularizations(token, managerId) {
  const { data, error } = await supabase.rpc('manager_get_team_regularizations', {
    p_token: token,
    p_manager_id: managerId,
  })
  if (error) throw error
  return (data || []).map(rowToRegularization)
}

export async function managerDecideRegularization(token, managerId, regId, status) {
  const { data, error } = await supabase.rpc('manager_decide_regularization', {
    p_token: token,
    p_manager_id: managerId,
    p_reg_id: regId,
    p_status: status,
  })
  if (error) throw error
  return rowToRegularization(data)
}

export async function adminGetRegularizations(token) {
  const { data, error } = await supabase.rpc('admin_get_regularizations', { p_token: token })
  if (error) throw error
  return (data || []).map(rowToRegularization)
}

export async function adminDecideRegularization(token, id, status) {
  const { data, error } = await supabase.rpc('admin_decide_regularization', {
    p_token: token,
    p_id: id,
    p_status: status,
  })
  if (error) throw error
  return rowToRegularization(data)
}
