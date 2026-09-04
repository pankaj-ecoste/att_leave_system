-- Pre-existing bug found while regression-testing plan.md §16 (unrelated to that
-- feature) — production's app_settings_public view was still the original 1-column
-- version from 0002 (`std_hours` only), even though 0020 and 0023 both widened it
-- (admin_email, then birthday_message) and PROGRESS.md's own P4/V2 write-up records it
-- as verified live at the time. Root cause: 0002's `drop view if exists` re-run-safety
-- guard means a later full `apply-migrations.mjs` replay attempt drops and recreates the
-- view back to its narrow 0002 shape before erroring out at migration 0010 (the known
-- broken-full-replay point, per memory/plan.md §13) — never reaching 0020/0023's
-- widening statements again in that same replay. Confirmed via direct anon-key call:
-- `select std_hours, admin_email, birthday_message from app_settings_public` was
-- failing with "column app_settings_public.admin_email does not exist" on every single
-- page load (silently swallowed by fetchAppSettings's try/catch fallback to defaults),
-- which meant the Apply Leave screen's "notify admin by email" link and any custom
-- birthday message in Settings were both silently reverting to defaults in production.
--
-- Fix: just re-apply the same widening 0023 already defined. Purely additive (append
-- only, no drop needed — CREATE OR REPLACE VIEW can only add columns).

create or replace view public.app_settings_public as
  select std_hours, admin_email, birthday_message from app_settings where id = 1;
