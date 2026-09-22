#!/usr/bin/env node
// One-time setup for plan.md §33.2 — writes the Supabase "service_role" key into
// storage_signing_settings so admin_get_leave_document_url / admin_get_travel_photo_url
// / manager_get_*_url / employee_get_own_travel_photo_url can mint short-lived signed
// links on a caller's behalf. This key is never exposed through any RPC (no anon
// grant, no "status" getter) — this script, which already needs full database access
// via DATABASE_URL, is the only place it's ever written from.
//
// Get the key from the Supabase dashboard: Settings -> API -> "service_role" secret
// (NOT the anon/publishable key already in .env.local — this is far more powerful and
// must never be committed, logged, or used client-side).
//
// Usage:
//   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
//     SERVICE_ROLE_KEY="eyJhbGciOi..." \
//     node scripts/set-storage-signing-key.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL to the HRMS project session-pooler connection string first.')
  process.exit(2)
}
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
if (!serviceRoleKey || serviceRoleKey.length < 20) {
  console.error('Set SERVICE_ROLE_KEY to the Supabase project\'s service_role secret (Settings -> API).')
  process.exit(2)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()
  try {
    await client.query(
      `update storage_signing_settings set service_role_key = $1, updated_at = now() where id = 1`,
      [serviceRoleKey]
    )
    const { rows } = await client.query(
      `select (service_role_key is not null and btrim(service_role_key) <> '') as is_set, updated_at from storage_signing_settings where id = 1`
    )
    console.log('storage_signing_settings updated:', rows[0])

    // Prove the whole chain works end-to-end, without exposing the key itself:
    // find any existing leave document or travel photo path and sign it directly via
    // the core function (bypasses the token-checked wrappers on purpose, just to prove
    // the HTTP call to Storage succeeds) — read-only, nothing written to those tables.
    const { rows: doc } = await client.query(`select document_path from leave_applications where document_path is not null limit 1`)
    const { rows: photo } = await client.query(`select photo_path from travel_visits limit 1`)
    if (doc.length) {
      const { rows: signed } = await client.query(`select storage_sign_url_core('leave-documents', $1, 60) as url`, [doc[0].document_path])
      console.log('Test sign (leave document) succeeded:', signed[0].url ? 'got a URL' : 'no URL')
    } else if (photo.length) {
      const { rows: signed } = await client.query(`select storage_sign_url_core('travel-selfies', $1, 60) as url`, [photo[0].photo_path])
      console.log('Test sign (travel photo) succeeded:', signed[0].url ? 'got a URL' : 'no URL')
    } else {
      console.log('No existing document/photo to test-sign against yet — key is set, chain unverified until one exists.')
    }
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Failed:', err.message)
  process.exit(1)
})
