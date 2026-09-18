import { supabase } from '../lib/supabase'
import {
  rowToTravelVisit, rowToTravelSummary, rowToTravelOverviewRow, rowToTravelSettlement, rowToTaSettings,
} from './mappers'

// plan.md §28 — Travel Allowance verification. Same private-bucket pattern as
// api/documents.js's leave-documents bucket: unguessable client-generated path, private
// (no public URL), read via a short-lived signed URL.
const TRAVEL_SELFIES_BUCKET = 'travel-selfies'

export async function uploadTravelSelfie(file) {
  const id = crypto.randomUUID()
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${id}/selfie.${ext}`
  const { error } = await supabase.storage.from(TRAVEL_SELFIES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error
  return path
}

export async function getTravelSelfieUrl(path, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from(TRAVEL_SELFIES_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export async function employeeAddTravelVisit(token, empId, { date, lat, lon, accuracyM, siteNote, photoPath }) {
  const { data, error } = await supabase.rpc('employee_add_travel_visit', {
    p_token: token, p_emp_id: empId, p_date: date, p_lat: lat, p_lon: lon,
    p_accuracy_m: accuracyM ?? null, p_site_note: siteNote, p_photo_path: photoPath,
  })
  if (error) throw error
  return rowToTravelVisit(data)
}

export async function employeeGetTravelJourney(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_travel_journey', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToTravelVisit)
}

export async function employeeGetTravelSummary(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_travel_summary', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return rowToTravelSummary(data?.[0])
}

export async function employeeGetTravelSettlements(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_travel_settlements', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToTravelSettlement)
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export async function managerGetTeamTravelSummary(token, managerId) {
  const { data, error } = await supabase.rpc('manager_get_team_travel_summary', { p_token: token, p_manager_id: managerId })
  if (error) throw error
  return (data || []).map(rowToTravelOverviewRow)
}

export async function managerGetTeamTravelJourney(token, managerId, empId) {
  const { data, error } = await supabase.rpc('manager_get_team_travel_journey', { p_token: token, p_manager_id: managerId, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToTravelVisit)
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminGetTravelOverview(token) {
  const { data, error } = await supabase.rpc('admin_get_travel_overview', { p_token: token })
  if (error) throw error
  return (data || []).map(rowToTravelOverviewRow)
}

export async function adminGetEmployeeTravelJourney(token, empId) {
  const { data, error } = await supabase.rpc('admin_get_employee_travel_journey', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToTravelVisit)
}

export async function adminGetTravelSettlements(token, empId) {
  const { data, error } = await supabase.rpc('admin_get_travel_settlements', { p_token: token, p_emp_id: empId })
  if (error) throw error
  return (data || []).map(rowToTravelSettlement)
}

export async function adminSetTaRateTier(token, empId, tier) {
  const { error } = await supabase.rpc('admin_set_ta_rate_tier', { p_token: token, p_emp_id: empId, p_tier: tier || null })
  if (error) throw error
}

export async function adminGetTaSettings(token) {
  const { data, error } = await supabase.rpc('admin_get_ta_settings', { p_token: token })
  if (error) throw error
  return rowToTaSettings(data)
}

export async function adminUpdateTaSettings(token, managerRatePerKm, executiveRatePerKm) {
  const { data, error } = await supabase.rpc('admin_update_ta_settings', {
    p_token: token, p_manager_rate: managerRatePerKm, p_executive_rate: executiveRatePerKm,
  })
  if (error) throw error
  return rowToTaSettings(data)
}

export async function adminOverrideTravelVisitDistance(token, visitId, newKm, reason) {
  const { data, error } = await supabase.rpc('admin_override_travel_visit_distance', {
    p_token: token, p_visit_id: visitId, p_new_km: newKm, p_reason: reason,
  })
  if (error) throw error
  return rowToTravelVisit(data)
}

// Settles the employee's whole current open period. The photos are deleted server-side
// inside the RPC itself (0045_travel_selfies_delete_policy_fix.sql) — there is no anon
// delete policy on the bucket, so the client never has (or needs) the ability to remove
// storage objects directly.
export async function adminSettleTravelPeriod(token, empId) {
  const { data, error } = await supabase.rpc('admin_settle_travel_period', { p_token: token, p_emp_id: empId })
  if (error) throw error
  const row = data?.[0]
  return {
    settlement: rowToTravelSettlement(row?.settlement),
  }
}
