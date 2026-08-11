-- The biometric-device Excel imports (Daily Bio, Monthly Bio) were speculative —
-- this app has no relationship to a biometric device and the feature was never used
-- (user request, 2026-08-11). Removing the upload-cache tables and their RPCs.
--
-- Deliberately NOT touched: attendance.app_in_time/app_out_time/bio_in_time/
-- bio_out_time/official_source/bio_status_raw/bio_source/monthly_source and the
-- employee_punch/admin_upsert_attendance/admin_bulk_upsert_attendance functions
-- (0009_app_vs_biometric.sql). official_source and app_in_time/app_out_time still do
-- real work distinguishing a live app punch from an admin's manual correction — that
-- has nothing to do with biometric devices. The bio_* columns simply stay unused going
-- forward; historical rows from past bio imports (if any) keep their values and
-- calcStatus's biometric-status fallback (lib/datetime.js) still reads them correctly
-- for that historical data.

drop function if exists public.admin_get_bio_sheet(uuid);
drop function if exists public.admin_set_bio_sheet(uuid, text, jsonb, jsonb, date, integer, integer);
drop function if exists public.admin_clear_bio_sheet(uuid);
drop function if exists public.admin_get_monthly_sheet(uuid);
drop function if exists public.admin_set_monthly_sheet(uuid, text, integer, integer, integer, integer);
drop function if exists public.admin_clear_monthly_sheet(uuid);

drop table if exists public.bio_sheet_cache;
drop table if exists public.monthly_sheet_cache;
