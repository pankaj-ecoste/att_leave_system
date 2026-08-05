import { supabase } from '../lib/supabase'

// `latLon` is the reverse-geocoded address text — a display label only. Real numeric
// coordinates (`meta` = { lat, lon, accuracy } from useGeolocation) are stored
// separately (0008_real_coords_background_tracking.sql) so a future fraud-check has
// actual numbers to compute against, not a string to parse.
export async function employeeLogLocation(token, empId, latLon, date, type = 'auto', meta = null) {
  const { data, error } = await supabase.rpc('employee_log_location', {
    p_token: token, p_emp_id: empId, p_lat_lon: latLon, p_date: date, p_type: type,
    p_lat: meta?.lat ?? null, p_lon: meta?.lon ?? null, p_accuracy_m: meta?.accuracy ?? null,
  })
  if (error) throw error
  return data
}

export async function employeeLogOdLocation(token, empId, latLon, date, meta = null) {
  const { data, error } = await supabase.rpc('employee_log_od_location', {
    p_token: token, p_emp_id: empId, p_lat_lon: latLon, p_date: date,
    p_lat: meta?.lat ?? null, p_lon: meta?.lon ?? null, p_accuracy_m: meta?.accuracy ?? null,
  })
  if (error) throw error
  return data
}

export async function employeeGetOdLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('employee_get_od_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, ts: r.ts, lat: r.lat, lon: r.lon, accuracyM: r.accuracy_m }))
}

export async function adminGetOdLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('admin_get_od_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, ts: r.ts, lat: r.lat, lon: r.lon, accuracyM: r.accuracy_m }))
}

export async function adminGetAllLocationLogs(token, date) {
  const { data, error } = await supabase.rpc('admin_get_all_location_logs', {
    p_token: token, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id, empId: r.emp_id, empName: r.emp_name, empNum: r.emp_num,
    date: r.date, latLon: r.lat_lon, type: r.type, capturedAt: r.captured_at,
    lat: r.lat, lon: r.lon, accuracyM: r.accuracy_m,
  }))
}

export async function adminGetLocationLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('admin_get_location_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, type: r.type, capturedAt: r.captured_at, lat: r.lat, lon: r.lon, accuracyM: r.accuracy_m }))
}
