import { supabase } from '../lib/supabase'
import { rowToSite, siteToPayload } from './mappers'

// Reads go straight through PostgREST — `sites` has a plain anon-select policy
// (0006_sites.sql), same posture as holidays, since the punch screen needs every
// employee to read office coordinates to compute live distance client-side.
export async function fetchSites() {
  const { data, error } = await supabase.from('sites').select('*').order('name')
  if (error) throw error
  return (data || []).map(rowToSite)
}

export async function adminCreateSite(token, site) {
  const { data, error } = await supabase.rpc('admin_create_site', { p_token: token, p_data: siteToPayload(site) })
  if (error) throw error
  return rowToSite(data)
}

export async function adminUpdateSite(token, id, site) {
  const { data, error } = await supabase.rpc('admin_update_site', { p_token: token, p_site_id: id, p_data: siteToPayload(site) })
  if (error) throw error
  return rowToSite(data)
}

export async function adminDeleteSite(token, id) {
  const { error } = await supabase.rpc('admin_delete_site', { p_token: token, p_site_id: id })
  if (error) throw error
}
