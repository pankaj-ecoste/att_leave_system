import { supabase } from '../lib/supabase'
import { rowToAsset, rowToEmployee } from './mappers'

// VA-8..VA-11 (plan.md §11) — free-text per-employee asset tracking. Admin has full
// CRUD from the employee profile; staff get a read-only view of their own.

export async function adminFetchEmployeeAssets(token, empId) {
  const { data, error } = await supabase.rpc('admin_get_employee_assets', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToAsset)
}

export async function employeeFetchOwnAssets(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_own_assets', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToAsset)
}

export async function adminUpsertEmployeeAsset(token, empId, asset) {
  const { data, error } = await supabase.rpc('admin_upsert_employee_asset', {
    p_token: token,
    p_asset_id: asset.id || null,
    p_emp_id: empId,
    p_asset_type: asset.assetType,
    p_serial_number: asset.serialNumber || null,
    p_assigned_date: asset.assignedDate || null,
    p_status: asset.status || null,
    p_assigned_by: asset.assignedBy || null,
  })
  if (error) throw error
  return rowToAsset(data)
}

export async function adminDeleteEmployeeAsset(token, assetId) {
  const { error } = await supabase.rpc('admin_delete_employee_asset', { p_token: token, p_asset_id: assetId })
  if (error) throw error
}

// Exit/offboarding (V2 decision 23) — one confirmation flag, not per-item return
// tracking. Only callable once the employee's status is already Exited (server-enforced).
export async function adminMarkAssetsReturned(token, empId) {
  const { data, error } = await supabase.rpc('admin_mark_assets_returned', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return rowToEmployee(data)
}
