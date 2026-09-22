-- plan.md §33.1 (system health audit, 2026-09-22) — closes 5 confirmed-live gaps where
-- the app's public (anon) key could reach data/functions with no login check at all.
-- This is the SAME root cause already fixed twice before in this project (log_audit,
-- run_annual_leave_rollover, both Day 3) — Supabase auto-grants every new function/table
-- to anon by default; only an explicit revoke actually blocks it. Confirmed live with a
-- read-only check before writing this (see scripts/check-331-anon-grants.mjs): all 5
-- were reachable.
--
-- Nothing here changes any function's BEHAVIOUR — this is permissions only. Every
-- function still works exactly the same for the legitimate token-checked callers that
-- reach it internally (a SECURITY DEFINER function's nested calls run as the function's
-- OWNER, not the original caller, same reason is_valid_admin_token has always worked
-- despite never being anon-granted itself — same fact already relied on for the Day 3
-- fixes).

-- ============ 1. leave_payouts — RLS was never enabled ============
-- Comment in 0014 claimed "reachable only through SECURITY DEFINER functions" without
-- ever actually enabling RLS to make that true. Confirmed live: anon had direct
-- SELECT/INSERT/UPDATE/DELETE on this table via Supabase's default grants.
alter table public.leave_payouts enable row level security;

-- ============ 2. geocode_cache — same gap ============
alter table public.geocode_cache enable row level security;

-- ============ 3-5. Three travel-distance helper functions — anon could call directly ============
-- All three were written with comments stating they should not be anon-reachable
-- ("no token check, NOT anon-granted — would let anyone refine anyone's distances
-- without auth if it were", 0049 line 9) but no revoke was ever added. Confirmed live:
-- anon could call all three directly.
revoke execute on function public.road_distance_km(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.travel_summary_for_employee(uuid) from public, anon, authenticated;
revoke execute on function public.travel_refine_distances_core(uuid) from public, anon, authenticated;
