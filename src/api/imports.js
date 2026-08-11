import { supabase } from '../lib/supabase'

// The leave-balance Excel importer keeps a one-row cache of the last upload so the
// admin can leave the import screen and come back without re-uploading. Kept out of
// attendance.js/leave.js since this is storage, not attendance/leave data itself.

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
