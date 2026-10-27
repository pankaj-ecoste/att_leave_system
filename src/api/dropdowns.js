import { supabase } from '../lib/supabase'

// plan.md §54 — the lists behind the Job Title / Department / Business Unit / Location dropdowns.
// All three calls need an admin token and are re-checked in the database.

const rowToOption = r => ({ id: r.id, kind: r.kind, value: r.value, inUse: Number(r.in_use ?? 0) })

export async function adminFetchDropdownOptions(token) {
  const { data, error } = await supabase.rpc('admin_get_dropdown_options', { p_token: token })
  if (error) throw error
  return (data || []).map(rowToOption)
}

export async function adminAddDropdownOption(token, kind, value) {
  const { data, error } = await supabase.rpc('admin_add_dropdown_option', { p_token: token, p_kind: kind, p_value: value })
  if (error) throw error
  return rowToOption(data)
}

export async function adminRemoveDropdownOption(token, id) {
  const { error } = await supabase.rpc('admin_remove_dropdown_option', { p_token: token, p_id: id })
  if (error) throw error
}
