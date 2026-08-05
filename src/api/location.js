import { supabase } from '../lib/supabase'

// Text lat/lon logging today (§4.4 — real coordinate storage + geofencing lands with
// the `sites` table in Day 2's 0004 migration). Kept intentionally thin until then.

export async function employeeLogLocation(token, empId, latLon, date, type = 'auto') {
  const { data, error } = await supabase.rpc('employee_log_location', {
    p_token: token, p_emp_id: empId, p_lat_lon: latLon, p_date: date, p_type: type,
  })
  if (error) throw error
  return data
}

export async function employeeLogOdLocation(token, empId, latLon, date) {
  const { data, error } = await supabase.rpc('employee_log_od_location', {
    p_token: token, p_emp_id: empId, p_lat_lon: latLon, p_date: date,
  })
  if (error) throw error
  return data
}

export async function employeeGetOdLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('employee_get_od_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, ts: r.ts }))
}

export async function adminGetOdLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('admin_get_od_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, ts: r.ts }))
}

export async function adminGetAllLocationLogs(token, date) {
  const { data, error } = await supabase.rpc('admin_get_all_location_logs', {
    p_token: token, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id, empId: r.emp_id, empName: r.emp_name, empNum: r.emp_num,
    date: r.date, latLon: r.lat_lon, type: r.type, capturedAt: r.captured_at,
  }))
}

export async function adminGetLocationLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('admin_get_location_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, type: r.type, capturedAt: r.captured_at }))
}
