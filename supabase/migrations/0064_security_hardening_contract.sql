-- Security hardening, phase 2 of 2 (contract). Apply ONLY after the phase-1 client
-- (login directory from fetch_login_directory, full directory and admin email after
-- sign-in) is live in production. Applying this earlier would break browsers still
-- running the previous app version.
--
-- Removes the remaining public exposure:
--   - fetch_directory() (full record for every employee, publicly callable)
--   - the employees_directory view (same data, publicly readable)
--   - admin_email in app_settings_public (the rest of the view stays public)

-- ============ 1. Old full public directory ============
revoke execute on function public.fetch_directory() from public, anon, authenticated;

-- ============ 2. Old directory view ============
revoke all on public.employees_directory from public, anon, authenticated;

-- ============ 3. Public settings: drop admin_email ============
drop view if exists public.app_settings_public;
create view public.app_settings_public as
  select std_hours, birthday_message from app_settings where id = 1;
revoke all on public.app_settings_public from public, anon, authenticated;
grant select on public.app_settings_public to anon, authenticated;
