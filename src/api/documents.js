import { supabase } from '../lib/supabase'

const LEAVE_DOCUMENTS_BUCKET = 'leave-documents'

// Private bucket, unguessable path (a fresh client-generated id, not tied to the
// leave application's own id since that doesn't exist yet at upload time — the
// application is only created after this upload succeeds). See 0019 migration.
export async function uploadLeaveDocument(file) {
  const id = crypto.randomUUID()
  const path = `${id}/${file.name}`
  const { error } = await supabase.storage.from(LEAVE_DOCUMENTS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error
  return path
}

// plan.md §33.2 — signing now happens server-side, inside a token-checked database
// function, instead of the browser being trusted to sign its own links: anon no longer
// has a read policy on this bucket at all (migration 0053), so these are the only way
// in. Split by role because each needs a different ownership check (admin: any
// document; manager: only a direct report's).
export async function adminGetLeaveDocumentUrl(token, path) {
  const { data, error } = await supabase.rpc('admin_get_leave_document_url', { p_token: token, p_path: path })
  if (error) throw error
  return data
}

export async function managerGetLeaveDocumentUrl(token, managerId, path) {
  const { data, error } = await supabase.rpc('manager_get_leave_document_url', { p_token: token, p_manager_id: managerId, p_path: path })
  if (error) throw error
  return data
}
