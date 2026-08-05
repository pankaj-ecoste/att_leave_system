-- Bootstrap rows the schema depends on but never creates itself. Without these:
--   - admin_login() always fails (app_settings has no row to read admin_pin_hash from)
--   - the three Excel-import cache functions UPDATE a row that doesn't exist yet, so
--     "set" silently does nothing until a row exists to update
-- Caught by actually running the app against the live schema, not just the smoke test
-- (which only checks a function is *reachable*, not that its data prerequisites exist).

insert into app_settings (id, admin_pin_hash, std_hours)
values (1, crypt('2026', gen_salt('bf')), 9)
on conflict (id) do nothing;

insert into bio_sheet_cache (id) values (1) on conflict (id) do nothing;
insert into imported_sheet_cache (id) values (1) on conflict (id) do nothing;
insert into monthly_sheet_cache (id) values (1) on conflict (id) do nothing;
