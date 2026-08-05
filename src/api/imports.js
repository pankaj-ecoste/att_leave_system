import { supabase } from '../lib/supabase'

// The three Excel importers (leave balances via leave.js's bulk upsert, Daily Bio,
// Monthly Bio) each keep a one-row cache of the last upload so the admin can leave the
// import screen and come back without re-uploading. Kept out of attendance.js/leave.js
// since these are storage, not attendance/leave data themselves.

// ---------------------------------------------------------------------------
// Generic "imported sheet" cache (used by the leave-balance importer's preview grid)
// ---------------------------------------------------------------------------

export async function adminFetchImportedSheet(token) {
  const { data, error } = await supabase.rpc('admin_get_imported_sheet', { p_token: token })
  if (error) throw error
  if (!data || !data.filename) return null
  return { filename: data.filename, cols: data.cols || [], rows: data.rows || [], importedAt: data.imported_at }
}

export async function adminSetImportedSheet(token, filename, cols, rows) {
  const { data, error } = await supabase.rpc('admin_set_imported_sheet', {
    p_token: token, p_filename: filename, p_cols: cols, p_rows: rows,
  })
  if (error) throw error
  return { filename: data.filename, cols: data.cols || [], rows: data.rows || [], importedAt: data.imported_at }
}

export async function adminClearImportedSheet(token) {
  const { error } = await supabase.rpc('admin_clear_imported_sheet', { p_token: token })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Daily Bio sheet cache
// ---------------------------------------------------------------------------

export async function adminFetchBioSheet(token) {
  const { data, error } = await supabase.rpc('admin_get_bio_sheet', { p_token: token })
  if (error) throw error
  if (!data || !data.filename) return null
  return {
    filename: data.filename, cols: data.cols || [], rows: data.rows || [],
    reportDate: data.report_date, synced: data.synced, skipped: data.skipped, importedAt: data.imported_at,
  }
}

export async function adminSetBioSheet(token, filename, cols, rows, reportDate, synced, skipped) {
  const { data, error } = await supabase.rpc('admin_set_bio_sheet', {
    p_token: token, p_filename: filename, p_cols: cols, p_rows: rows,
    p_report_date: reportDate, p_synced: synced, p_skipped: skipped,
  })
  if (error) throw error
  return {
    filename: data.filename, cols: data.cols || [], rows: data.rows || [],
    reportDate: data.report_date, synced: data.synced, skipped: data.skipped, importedAt: data.imported_at,
  }
}

export async function adminClearBioSheet(token) {
  const { error } = await supabase.rpc('admin_clear_bio_sheet', { p_token: token })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Monthly Bio sheet cache (metadata only — the monthly grid format is too
// large/irregular to cache row-by-row, so only summary info is stored)
// ---------------------------------------------------------------------------

export async function adminFetchMonthlySheet(token) {
  const { data, error } = await supabase.rpc('admin_get_monthly_sheet', { p_token: token })
  if (error) throw error
  if (!data || !data.filename) return null
  return {
    filename: data.filename, reportMonth: data.report_month, reportYear: data.report_year,
    synced: data.synced, skipped: data.skipped, importedAt: data.imported_at,
  }
}

export async function adminSetMonthlySheet(token, filename, reportMonth, reportYear, synced, skipped) {
  const { data, error } = await supabase.rpc('admin_set_monthly_sheet', {
    p_token: token, p_filename: filename, p_report_month: reportMonth, p_report_year: reportYear,
    p_synced: synced, p_skipped: skipped,
  })
  if (error) throw error
  return {
    filename: data.filename, reportMonth: data.report_month, reportYear: data.report_year,
    synced: data.synced, skipped: data.skipped, importedAt: data.imported_at,
  }
}

export async function adminClearMonthlySheet(token) {
  const { error } = await supabase.rpc('admin_clear_monthly_sheet', { p_token: token })
  if (error) throw error
}
