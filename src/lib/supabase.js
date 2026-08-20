import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  // This will show up clearly in the browser console rather than failing silently.
  console.error(
    'Missing Supabase environment variables. Check your .env.local file (or your Vercel project settings) for VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// plan.md §13 — every employee/admin/manager API call in src/api/*.js goes through
// supabase.rpc(), so this is the one place that can catch an expired employee session
// centrally instead of special-casing ~30 call sites. Passes every result through
// unchanged; the only side effect is dispatching an event when the exact employee-facing
// message is seen (never the admin-panel one — that's worded "Invalid admin session" /
// "Invalid or expired admin session", deliberately distinct, and left untouched).
const rawRpc = supabase.rpc.bind(supabase)
supabase.rpc = (...args) => {
  return rawRpc(...args).then(result => {
    if (result?.error?.message === 'Invalid or expired session') {
      window.dispatchEvent(new Event('hrms:employee-session-expired'))
    }
    return result
  })
}
