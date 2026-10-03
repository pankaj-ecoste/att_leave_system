import { supabase } from '../lib/supabase'

// plan.md §45 — facts the admin Analytics tab cannot get from data already on the admin's
// screen. Both are read-only, admin-token checked, and return plain arrays.

// How many times HR reset each person's device: [{ name, inRange, total }].
export async function adminGetDeviceResetCounts(token, from, to) {
  const { data, error } = await supabase.rpc('admin_get_device_reset_counts', { p_token: token, p_from: from, p_to: to })
  if (error) throw error
  return data || []
}

// Per employee, in the date range: visits, km and the busiest single day, counting visits that
// were archived when a travel period was paid:
// [{ empId, name, company, visits, km, bestDayVisits, bestDayDate }].
export async function adminGetTravelAnalytics(token, from, to) {
  const { data, error } = await supabase.rpc('admin_get_travel_analytics', { p_token: token, p_from: from, p_to: to })
  if (error) throw error
  return data || []
}
