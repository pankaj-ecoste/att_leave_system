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

// Short-lived signed URL — the bucket is private, so a plain public URL won't work.
export async function getLeaveDocumentUrl(path, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from(LEAVE_DOCUMENTS_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
