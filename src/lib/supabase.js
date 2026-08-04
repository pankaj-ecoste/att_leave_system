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
