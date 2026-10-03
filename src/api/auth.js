import { supabase } from '../lib/supabase'
import { rowToEmployee } from './mappers'

// ---------------------------------------------------------------------------
// Public reads (no login required) — power the login screen. Only the minimum the
// login list needs (name, employee number, company, active). Everything else about
// an employee comes after sign-in, through login-checked calls below (migration 0063).
// ---------------------------------------------------------------------------

export async function fetchDirectory() {
  const { data, error } = await supabase.rpc('fetch_login_directory')
  if (error) throw error
  return (data || []).map(rowToEmployee)
}

// The full directory, for a signed-in employee only (phone, email, etc. for the
// leave-request manager details). Requires their session token.
export async function fetchFullDirectory(token, empId) {
  const { data, error } = await supabase.rpc('employee_fetch_directory', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToEmployee)
}

// Admin contact address — shown only to signed-in staff and admins.
export async function fetchEmployeeAdminEmail(token, empId) {
  const { data, error } = await supabase.rpc('employee_fetch_admin_email', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return data || null
}

export async function fetchAdminAdminEmail(token) {
  const { data, error } = await supabase.rpc('admin_fetch_admin_email', { p_token: token })
  if (error) throw error
  return data || null
}

export async function fetchAppSettings() {
  const { data, error } = await supabase.from('app_settings_public').select('std_hours, birthday_message').single()
  if (error) {
    console.error(error)
    return { stdHours: 9, adminEmail: null, birthdayMessage: null }
  }
  return { stdHours: Number(data.std_hours) || 9, adminEmail: null, birthdayMessage: data.birthday_message || null }
}

// One employee's target hours, resolved fresh (their override if set, else the org
// default) in a single round trip — plan.md §16. Used at the same write-time points
// that already fetch app_settings.std_hours fresh rather than trust a stale prop
// (useEmployeeAttendance's punch flow, useAdminAttendance's editCell — plan.md §15.2).
export async function fetchEffectiveStdHours(empId, fallback = 9) {
  const { data, error } = await supabase.rpc('get_effective_std_hours', { p_emp_id: empId })
  if (error) {
    console.error(error)
    return fallback
  }
  return Number(data) || fallback
}

// ---------------------------------------------------------------------------
// Employee login/session
// ---------------------------------------------------------------------------

// deviceNote (plan.md §38) is a short "how was the app opened / was the id new" string the
// server adds to the audit log when a device is registered, restored or blocked.
export async function employeeLogin(employeeId, pin, deviceId, deviceNote) {
  const { data, error } = await supabase.rpc('employee_login', {
    p_employee_id: employeeId,
    p_pin: pin,
    p_device_id: deviceId,
    p_device_note: deviceNote,
  })
  if (error) {
    console.error(error)
    return { token: null, error: 'network' }
  }
  return { token: data?.token || null, error: data?.error || null, lockedUntil: data?.locked_until || null }
}

export async function employeeLogout(token) {
  if (!token) return
  const { error } = await supabase.rpc('employee_logout', { p_token: token })
  if (error) console.error(error)
}

// ---------------------------------------------------------------------------
// Admin login/session
// ---------------------------------------------------------------------------

// plan.md §37 — the lock is per device (plus a company-wide safety cap), so the device id
// goes along, and the answer says why a login failed instead of just "no token".
export async function adminLogin(pin, deviceId) {
  const { data, error } = await supabase.rpc('admin_login', { p_pin: pin, p_device_id: deviceId })
  if (error) {
    console.error(error)
    return { token: null, error: 'network' }
  }
  return {
    token: data?.token || null,
    error: data?.error || null,
    lockedUntil: data?.locked_until || null,
    triesLeft: data?.tries_left ?? null,
  }
}

export async function adminLogout(token) {
  if (!token) return
  const { error } = await supabase.rpc('admin_logout', { p_token: token })
  if (error) console.error(error)
}
