#!/usr/bin/env node
// One-off verification for plan.md §33.2 — proves the actual wrapper functions the app
// calls (not just the internal core signer) work end-to-end, via real RPC calls inside
// a rolled-back transaction. Nothing is written to real data.
//
// Usage:
//   DATABASE_URL="..." node scripts/verify-0053-end-to-end.mjs

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL first.')
  process.exit(2)
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query('BEGIN')
  try {
    const testToken = '33333333-3333-3333-3333-333333333333'
    await client.query(`insert into admin_sessions (token, expires_at) values ($1, now() + interval '5 minutes')`, [testToken])

    const { rows: doc } = await client.query(`select document_path from leave_applications where document_path is not null limit 1`)
    if (doc.length) {
      const { rows } = await client.query(`select admin_get_leave_document_url($1, $2) as url`, [testToken, doc[0].document_path])
      console.log('admin_get_leave_document_url: OK, got a URL:', !!rows[0].url)
    } else {
      console.log('No leave document to test against — skipped.')
    }

    const { rows: photo } = await client.query(`select photo_path from travel_visits limit 1`)
    if (photo.length) {
      const { rows } = await client.query(`select admin_get_travel_photo_url($1, $2) as url`, [testToken, photo[0].photo_path])
      console.log('admin_get_travel_photo_url: OK, got a URL:', !!rows[0].url)
    } else {
      console.log('No travel photo to test against — skipped.')
    }

    // Negative check: admin function should reject a made-up path that matches nothing.
    try {
      await client.query(`select admin_get_travel_photo_url($1, $2)`, [testToken, 'not-a-real-path/nope.jpg'])
      console.error('!! admin_get_travel_photo_url did NOT reject a bogus path — this should have failed')
    } catch (e) {
      console.log('Bogus path correctly rejected:', e.message)
    }
  } finally {
    await client.query('ROLLBACK')
    console.log('Rolled back — no real data touched.')
    await client.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
