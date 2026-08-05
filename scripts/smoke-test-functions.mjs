#!/usr/bin/env node
// G-2 guardrail — "smoke test across every function".
//
// Calls every RPC function against a live Supabase project and confirms none error and
// none 404. A missing `EXECUTE ... TO anon` grant (P1-3) is invisible until a real user
// hits it in production — this is the check that catches it first.
//
// Usage: VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... node scripts/smoke-test-functions.mjs
// (reads the same two env vars the app uses — see .env.local)

import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY first (same values as .env.local).')
  process.exit(2)
}
const supabase = createClient(url, key)

// A 404 or "function does not exist" means the migration or the EXECUTE grant is
// missing — that's the failure this script exists to catch. Any other error (bad
// token, not found, etc.) is expected: these calls run with fake IDs, no real login.
function isGrantOrMigrationFailure(error) {
  if (!error) return false
  const msg = (error.message || '').toLowerCase()
  return (
    error.code === 'PGRST202' || // PostgREST: function not found in schema cache
    msg.includes('does not exist') ||
    msg.includes('permission denied') ||
    msg.includes('404')
  )
}

const FAKE_UUID = '00000000-0000-0000-0000-000000000000'
const TODAY = new Date().toISOString().slice(0, 10)

// [name, args] — every function reachable from the frontend. Auth-checked functions
// are called with a fake token/id on purpose: the goal is "the function exists and is
// callable", not "the fake call succeeds". A clean 401-style rejection is a pass.
const CALLS = [
  ['fetch_directory', {}],
  ['employee_login', { p_employee_id: FAKE_UUID, p_pin: '0000' }],
  ['employee_logout', { p_token: FAKE_UUID }],
  ['employee_get_attendance', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['employee_punch', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_data: { date: TODAY } }],
  ['employee_apply_leave', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_data: { date: TODAY } }],
  ['employee_get_leaves', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['employee_get_leave_balances', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['employee_submit_regularization', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_date: TODAY, p_in: '09:00', p_out: '18:00', p_reason: 'test' }],
  ['employee_get_regularizations', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['employee_log_location', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_lat_lon: '0,0', p_date: TODAY }],
  ['employee_log_od_location', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_lat_lon: '0,0', p_date: TODAY }],
  ['employee_get_od_logs', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_date: TODAY }],
  ['employee_get_my_team', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['manager_get_team_attendance', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID, p_month: 1, p_year: 2026 }],
  ['manager_get_team_leaves', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID }],
  ['manager_decide_leave', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID, p_leave_id: FAKE_UUID, p_status: 'Approved' }],
  ['manager_get_team_regularizations', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID }],
  ['manager_decide_regularization', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID, p_reg_id: FAKE_UUID, p_status: 'Approved' }],
  ['admin_login', { p_pin: '0000' }],
  ['admin_logout', { p_token: FAKE_UUID }],
  ['admin_update_settings', { p_token: FAKE_UUID, p_std_hours: 9 }],
  ['admin_get_audit_logs', { p_token: FAKE_UUID, p_limit: 10 }],
  ['admin_get_employees', { p_token: FAKE_UUID }],
  ['admin_create_employee', { p_token: FAKE_UUID, p_data: { name: 'test' } }],
  ['admin_update_employee', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_data: {} }],
  ['admin_set_employment_status', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_status: 'Confirmed' }],
  ['admin_toggle_employee_status', { p_token: FAKE_UUID, p_id: FAKE_UUID }],
  ['admin_delete_employee', { p_token: FAKE_UUID, p_id: FAKE_UUID }],
  ['admin_get_attendance', { p_token: FAKE_UUID }],
  ['admin_upsert_attendance', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_data: { date: TODAY } }],
  ['admin_bulk_upsert_attendance', { p_token: FAKE_UUID, p_records: [] }],
  ['admin_get_leaves', { p_token: FAKE_UUID }],
  ['admin_decide_leave', { p_token: FAKE_UUID, p_leave_id: FAKE_UUID, p_decision: 'Approved' }],
  ['admin_get_leave_balances', { p_token: FAKE_UUID }],
  ['admin_upsert_leave_balance', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_leave_type: 'Casual', p_accrued: 0, p_consumed: 0, p_balance: 0, p_quota: 0, p_unit: 'Days' }],
  ['admin_bulk_upsert_leave_balances', { p_token: FAKE_UUID, p_records: [] }],
  ['admin_fetch_all_leave_balances', { p_token: FAKE_UUID }],
  ['admin_reset_leave_balances', { p_token: FAKE_UUID }],
  ['admin_get_holidays', { p_token: FAKE_UUID }],
  ['admin_add_holiday', { p_token: FAKE_UUID, p_date: TODAY, p_name: 'test', p_type: 'Public' }],
  ['admin_delete_holiday', { p_token: FAKE_UUID, p_id: FAKE_UUID }],
  ['admin_get_regularizations', { p_token: FAKE_UUID }],
  ['admin_decide_regularization', { p_token: FAKE_UUID, p_id: FAKE_UUID, p_status: 'Approved' }],
  ['admin_get_all_location_logs', { p_token: FAKE_UUID, p_date: TODAY }],
  ['admin_get_location_logs', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_date: TODAY }],
  ['admin_get_od_logs', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_date: TODAY }],
  ['admin_get_imported_sheet', { p_token: FAKE_UUID }],
  ['admin_set_imported_sheet', { p_token: FAKE_UUID, p_filename: 'test.xlsx', p_cols: [], p_rows: [] }],
  ['admin_clear_imported_sheet', { p_token: FAKE_UUID }],
  ['admin_get_bio_sheet', { p_token: FAKE_UUID }],
  ['admin_set_bio_sheet', { p_token: FAKE_UUID, p_filename: 'test.xlsx', p_cols: [], p_rows: [], p_report_date: TODAY, p_synced: 0, p_skipped: 0 }],
  ['admin_clear_bio_sheet', { p_token: FAKE_UUID }],
  ['admin_get_monthly_sheet', { p_token: FAKE_UUID }],
  ['admin_set_monthly_sheet', { p_token: FAKE_UUID, p_filename: 'test.xlsx', p_report_month: 1, p_report_year: 2026, p_synced: 0, p_skipped: 0 }],
  ['admin_clear_monthly_sheet', { p_token: FAKE_UUID }],
]

async function main() {
  let failures = 0
  for (const [name, args] of CALLS) {
    const { error } = await supabase.rpc(name, args)
    if (isGrantOrMigrationFailure(error)) {
      failures++
      console.log(`✗ ${name}: ${error.message}`)
    } else {
      console.log(`✓ ${name}${error ? ` (rejected as expected: ${error.message})` : ''}`)
    }
  }
  console.log(`\n${CALLS.length - failures}/${CALLS.length} functions reachable.`)
  if (failures > 0) {
    console.log(`${failures} missing/misconfigured — check migrations applied and EXECUTE grants.`)
    process.exit(1)
  }
  process.exit(0)
}

main()
