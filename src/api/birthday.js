import { supabase } from '../lib/supabase'

// VA-5..VA-7 (plan.md §11) — computed live off today's date, no cron job and no stored
// "shown today" flag (see the migration comment in 0023_v2_phase_a.sql for why).

// Only ever returns a boolean for the logged-in caller — date_of_birth itself is never
// exposed through an anon-readable channel.
export async function employeeGetBirthdayToday(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_birthday_today', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return !!data
}

export async function adminGetTodaysBirthdays(token) {
  const { data, error } = await supabase.rpc('admin_get_todays_birthdays', { p_token: token })
  if (error) throw error
  return (data || []).map(r => ({ empId: r.emp_id, name: r.name, company: r.company, acked: !!r.acked }))
}

export async function adminMarkBirthdayWished(token, empId) {
  const { error } = await supabase.rpc('admin_mark_birthday_wished', { p_token: token, p_emp_id: empId })
  if (error) throw error
}
