import { supabase } from '../lib/supabase'
import { rowToAuditLog } from './mappers'

// Note: there is no client-side insertAuditLog() anymore. `audit_logs` no longer has an
// anon insert policy (plan.md §4.3 #3 — "anyone can forge audit log entries") — writes
// happen only from inside the SECURITY DEFINER functions themselves, via the database's
// log_audit() helper. If a new admin action needs an audit trail, add the log_audit()
// call inside its function in 0003_hrms_functions.sql, not from the frontend.

export async function adminFetchAuditLogs(token, limit = 500) {
  const { data, error } = await supabase.rpc('admin_get_audit_logs', {
    p_token: token,
    p_limit: limit,
  })
  if (error) throw error
  return (data || []).map(rowToAuditLog)
}

export async function adminUpdateSettings(token, stdHours, newAdminPin) {
  const { error } = await supabase.rpc('admin_update_settings', {
    p_token: token,
    p_std_hours: stdHours,
    p_new_admin_pin: newAdminPin || null,
  })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export async function fetchHolidays() {
  const { data, error } = await supabase.from('holidays').select('*').order('date')
  if (error) throw error
  return (data || []).map(h => ({ id: h.id, date: h.date, name: h.name, type: h.type }))
}

export async function adminAddHoliday(token, date, name, type) {
  const { data, error } = await supabase.rpc('admin_add_holiday', {
    p_token: token, p_date: date, p_name: name, p_type: type,
  })
  if (error) throw error
  return { id: data.id, date: data.date, name: data.name, type: data.type }
}

export async function adminDeleteHoliday(token, id) {
  const { error } = await supabase.rpc('admin_delete_holiday', { p_token: token, p_id: id })
  if (error) throw error
}
