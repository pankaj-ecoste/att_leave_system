import { supabase } from '../lib/supabase'
import { rowToEmployee, employeeToPayload } from './mappers'

// Every function here requires a valid admin (or, for the team ones, employee) token
// from auth.js and is re-checked on the database side, not just here.

export async function adminFetchEmployees(token) {
  const { data, error } = await supabase.rpc('admin_get_employees', { p_token: token })
  if (error) throw error
  return (data || []).map(rowToEmployee)
}

export async function adminCreateEmployee(token, emp) {
  const { data, error } = await supabase.rpc('admin_create_employee', {
    p_token: token,
    p_data: employeeToPayload(emp),
  })
  if (error) throw error
  return rowToEmployee(data)
}

export async function adminUpdateEmployee(token, id, emp) {
  const { data, error } = await supabase.rpc('admin_update_employee', {
    p_token: token,
    p_emp_id: id,
    p_data: employeeToPayload(emp),
  })
  if (error) throw error
  return rowToEmployee(data)
}

// Probation / Confirmed / Notice Period / Exited — decision 19, plan.md §6A.
export async function adminSetEmploymentStatus(token, id, status, probationEndDate = null) {
  const { data, error } = await supabase.rpc('admin_set_employment_status', {
    p_token: token,
    p_emp_id: id,
    p_status: status,
    p_probation_end_date: probationEndDate,
  })
  if (error) throw error
  return rowToEmployee(data)
}

export async function adminToggleEmployeeStatus(token, id) {
  const { data, error } = await supabase.rpc('admin_toggle_employee_status', {
    p_token: token,
    p_id: id,
  })
  if (error) throw error
  return rowToEmployee(data)
}

export async function adminDeleteEmployee(token, id) {
  const { error } = await supabase.rpc('admin_delete_employee', { p_token: token, p_id: id })
  if (error) throw error
}

export async function employeeGetMyTeam(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_my_team', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  return (data || []).map(rowToEmployee)
}
