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
  ['employee_log_location', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_lat_lon: '0,0', p_date: TODAY, p_lat: 0, p_lon: 0, p_accuracy_m: 10 }],
  ['employee_log_od_location', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_lat_lon: '0,0', p_date: TODAY, p_lat: 0, p_lon: 0, p_accuracy_m: 10 }],
  ['employee_get_od_logs', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID, p_date: TODAY }],
  ['employee_get_my_team', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['manager_get_team_attendance', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID, p_month: 1, p_year: 2026 }],
  ['manager_get_team_location_logs', { p_token: FAKE_UUID, p_manager_id: FAKE_UUID, p_date: TODAY }],
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
  // Sites (P3-1) — admin-only writes; reads go straight through PostgREST (`sites`
  // has an anon select policy, 0006), so there's no fetch RPC to smoke-test here.
  ['admin_create_site', { p_token: FAKE_UUID, p_data: { name: 'test', latitude: 0, longitude: 0 } }],
  ['admin_update_site', { p_token: FAKE_UUID, p_site_id: FAKE_UUID, p_data: {} }],
  ['admin_delete_site', { p_token: FAKE_UUID, p_site_id: FAKE_UUID }],
  // Reverse geocoding (P3-9) — no token, just needs to be reachable and not 404.
  // Real coordinates so a live run also proves the http extension + cache actually work.
  ['reverse_geocode', { p_lat: 21.1458, p_lon: 79.0882 }],
  // Geofence helpers (P3-2) — no token; a real point near the seeded ECOSTE site so a
  // live run also proves haversine_m/nearest_active_site actually execute.
  ['nearest_active_site', { p_lat: 28.702994, p_lon: 77.156833 }],
  // V2 Phase A (0023_v2_phase_a.sql) — birthdays + asset management.
  ['employee_get_birthday_today', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['admin_get_todays_birthdays', { p_token: FAKE_UUID }],
  ['admin_mark_birthday_wished', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['admin_get_employee_assets', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['employee_get_own_assets', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  ['admin_upsert_employee_asset', { p_token: FAKE_UUID, p_asset_id: null, p_emp_id: FAKE_UUID, p_asset_type: 'test' }],
  ['admin_delete_employee_asset', { p_token: FAKE_UUID, p_asset_id: FAKE_UUID }],
  ['admin_mark_assets_returned', { p_token: FAKE_UUID, p_emp_id: FAKE_UUID }],
  // V2 Phase C (0024_v2_phase_c_comp_off_and_accrual.sql) — monthly CL/EL accrual
  // ledger + Compensatory Leave. The run_* crediting/expiry functions (monthly
  // accrual, annual rollover, comp-off accrual/expiry) are deliberately NOT anon-
  // callable (cron/internal-only, same posture as run_annual_leave_rollover already
  // excluded from this list) — only the two read-only admin RPCs are smoke-tested here.
  ['admin_get_leave_accruals', { p_token: FAKE_UUID }],
  ['admin_get_comp_off_payouts', { p_token: FAKE_UUID }],
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
