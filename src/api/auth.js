import { supabase } from '../lib/supabase'
import { rowToEmployee } from './mappers'

// ---------------------------------------------------------------------------
// Public reads (no login required) — power the login screen. Only touch the
// view/table anon is allowed to read directly, per the RLS policies in
// 0002_hrms_schema.sql.
// ---------------------------------------------------------------------------

export async function fetchDirectory() {
  const { data, error } = await supabase.rpc('fetch_directory')
  if (error) {
    // fallback to the view if the RPC fails for any reason
    const { data: d2, error: e2 } = await supabase.from('employees_directory').select('*')
    if (e2) throw e2
    return (d2 || []).map(rowToEmployee)
  }
  return (data || []).map(rowToEmployee)
}

export async function fetchStdHours() {
  const { data, error } = await supabase.from('app_settings_public').select('std_hours').single()
  if (error) {
    console.error(error)
    return 9
  }
  return Number(data.std_hours) || 9
}

// ---------------------------------------------------------------------------
// Employee login/session
// ---------------------------------------------------------------------------

export async function employeeLogin(employeeId, pin) {
  const { data, error } = await supabase.rpc('employee_login', {
    p_employee_id: employeeId,
    p_pin: pin,
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

export async function adminLogin(pin) {
  const { data, error } = await supabase.rpc('admin_login', { p_pin: pin })
  if (error) {
    console.error(error)
    return null
  }
  return data || null // a uuid token, or null if the PIN was wrong / locked out
}

export async function adminLogout(token) {
  if (!token) return
  const { error } = await supabase.rpc('admin_logout', { p_token: token })
  if (error) console.error(error)
}
