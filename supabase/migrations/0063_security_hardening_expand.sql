-- Security hardening, phase 1 of 2 (expand). Backward compatible: everything the
-- currently deployed app calls keeps working unchanged. Phase 2 (0064) removes the
-- old public exposure once the new client is live.
--
-- Found by the 2026-10-03 live review:
--   - fetch_directory() is publicly callable and returns email, phone, joining date and
--     more for every active employee. The app's login list only needs id/name/emp_num/
--     company/active. New fetch_login_directory() returns exactly that; the full record
--     moves behind a login-checked call (employee_fetch_directory) used after sign-in.
--   - The admin email was public via app_settings_public. Now read after sign-in only.
--   - leave_balance_editor exposed every employee's email and balances publicly. The app
--     never reads it. Access removed.
--   - The old 3-argument admin_update_settings was still live and changed the admin PIN
--     without the old-PIN check. The app only calls the 6-argument version. Dropped.
--   - Admin PIN: a 4-character PIN plus a per-20-minute cap of 30 wrong guesses allowed a
--     full 4-digit search in about 5 days. Added a 24-hour cap (120 wrong guesses) and a
--     minimum length of 8 for NEW admin PINs (existing PINs keep working).
--   - Trigger functions and internal helpers were callable by anyone holding the public key.
--   - The public key held TRUNCATE/REFERENCES/TRIGGER rights on every table (not blocked by
--     row-level security).
--   - reverse_geocode() is called from the browser, so it stays public, but it could grow
--     the cache without limit. Capped at 1000 new cached places per hour.

-- ============ 1. Minimal login directory (replaces the public full directory) ============
create or replace function public.fetch_login_directory()
 returns table(id uuid, name text, company text, emp_num text, active boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select e.id, e.name, e.company, e.emp_num, e.active
  from employees e where e.active = true order by e.name;
$function$;

grant execute on function public.fetch_login_directory() to anon;

-- ============ 2. Full directory, only after a login-checked token ============
create or replace function public.employee_fetch_directory(p_token uuid, p_emp_id uuid)
 returns table(id uuid, name text, company text, emp_num text, job_title text, bu text, dept text, sub_dept text, location_info text, cost_center text, manager text, email text, phone text, joining_date date, active boolean, shift_type text, manager_emp_id uuid, work_mode text, std_hours_override numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select e.id, e.name, e.company, e.emp_num, e.job_title,
    e.business_unit, e.department, e.sub_department, e.location_info, e.cost_center,
    e.manager, e.email, e.phone, e.joining_date, e.active,
    e.shift_type, e.manager_emp_id, e.work_mode, e.std_hours_override
  from employees e where e.active = true order by e.name;
end;
$function$;

grant execute on function public.employee_fetch_directory(uuid, uuid) to anon;

-- ============ 3. Admin email, read only after login ============
create or replace function public.employee_fetch_admin_email(p_token uuid, p_emp_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return (select admin_email from app_settings where id = 1);
end;
$function$;

grant execute on function public.employee_fetch_admin_email(uuid, uuid) to anon;

create or replace function public.admin_fetch_admin_email(p_token uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return (select admin_email from app_settings where id = 1);
end;
$function$;

grant execute on function public.admin_fetch_admin_email(uuid) to anon;

-- ============ 4. Remove the orphaned 3-argument admin_update_settings ============
-- The app calls the 6-argument version only (src/api/admin.js). The 3-argument one
-- skipped the old-PIN check; Day 3 removed it, but it came back.
drop function if exists public.admin_update_settings(uuid, numeric, text);

-- ============ 5. Admin PIN: minimum length for NEW PINs + daily brute-force cap ============
-- Minimum length only applies when an admin sets a new PIN. Existing PINs still log in.
create or replace function public.admin_update_settings(
  p_token uuid, p_std_hours numeric, p_new_admin_pin text default null::text,
  p_old_pin text default null::text, p_admin_email text default null::text,
  p_birthday_message text default null::text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_current_hash text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_new_admin_pin is not null then
    if length(p_new_admin_pin) < 8 then
      raise exception 'Admin PIN must be at least 8 characters';
    end if;
    select admin_pin_hash into v_current_hash from app_settings where id = 1;
    if p_old_pin is null or crypt(p_old_pin, v_current_hash) is distinct from v_current_hash then
      raise exception 'Current PIN is incorrect';
    end if;
    update app_settings set
      std_hours = p_std_hours,
      admin_pin_hash = crypt(p_new_admin_pin, gen_salt('bf')),
      admin_email = coalesce(p_admin_email, admin_email),
      birthday_message = coalesce(p_birthday_message, birthday_message)
      where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours || ', admin pin changed', 'admin');
  else
    update app_settings set
      std_hours = p_std_hours,
      admin_email = coalesce(p_admin_email, admin_email),
      birthday_message = coalesce(p_birthday_message, birthday_message)
      where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours, 'admin');
  end if;
  return true;
end;
$function$;

-- When does the company-wide 24-hour cap end? Same shape as _admin_login_unlock_at:
-- locked while 120 or more wrong PINs were entered in the last 24 hours; unlocks when
-- the 120th most recent one turns 24 hours old.
create or replace function public._admin_login_daily_unlock_at(p_limit int)
 returns timestamptz
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select t.failed_at + interval '24 hours'
  from (
    select failed_at, row_number() over (order by failed_at desc) as rn
    from admin_login_failures
    where failed_at > now() - interval '24 hours'
  ) t
  where t.rn = p_limit;
$function$;
revoke execute on function public._admin_login_daily_unlock_at(int) from public, anon, authenticated;

create or replace function public.admin_login(p_pin text, p_device_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  c_device_limit constant int := 3;
  c_global_limit constant int := 30;
  c_daily_limit constant int := 120;
  v_device text := left(coalesce(nullif(trim(p_device_id), ''), 'unknown'), 64);
  v_hash text; v_token uuid; v_until timestamptz; v_device_fails int;
begin
  perform pg_advisory_xact_lock(hashtext('admin_login'));
  delete from admin_login_failures where failed_at < now() - interval '25 hours';

  -- Already locked? Reject WITHOUT counting this attempt.
  v_until := _admin_login_unlock_at(v_device, c_device_limit);
  if v_until is not null then
    return jsonb_build_object('token', null, 'error', 'locked', 'locked_until', v_until, 'tries_left', 0);
  end if;
  v_until := _admin_login_unlock_at(null, c_global_limit);
  if v_until is not null then
    return jsonb_build_object('token', null, 'error', 'locked_global', 'locked_until', v_until, 'tries_left', 0);
  end if;
  v_until := _admin_login_daily_unlock_at(c_daily_limit);
  if v_until is not null then
    return jsonb_build_object('token', null, 'error', 'locked_global', 'locked_until', v_until, 'tries_left', 0);
  end if;

  select admin_pin_hash into v_hash from app_settings where id = 1;
  if v_hash is null or v_hash <> crypt(p_pin, v_hash) then
    insert into admin_login_failures (device_id) values (v_device);

    v_until := _admin_login_unlock_at(v_device, c_device_limit);
    if v_until is not null then
      perform log_audit('ADMIN_LOGIN_LOCKED', 'Admin login locked for one device after ' || c_device_limit || ' wrong PINs (device ' || left(v_device, 8) || ')', 'system');
      return jsonb_build_object('token', null, 'error', 'locked', 'locked_until', v_until, 'tries_left', 0);
    end if;
    v_until := _admin_login_unlock_at(null, c_global_limit);
    if v_until is not null then
      perform log_audit('ADMIN_LOGIN_GLOBAL_LOCK', 'Admin login locked for EVERYONE — ' || c_global_limit || ' wrong PINs from all devices in 20 minutes (possible guessing)', 'system');
      return jsonb_build_object('token', null, 'error', 'locked_global', 'locked_until', v_until, 'tries_left', 0);
    end if;
    v_until := _admin_login_daily_unlock_at(c_daily_limit);
    if v_until is not null then
      perform log_audit('ADMIN_LOGIN_DAILY_LOCK', 'Admin login locked for EVERYONE — ' || c_daily_limit || ' wrong PINs in 24 hours (possible guessing)', 'system');
      return jsonb_build_object('token', null, 'error', 'locked_global', 'locked_until', v_until, 'tries_left', 0);
    end if;

    select count(*) into v_device_fails from admin_login_failures
      where device_id = v_device and failed_at > now() - interval '20 minutes';
    return jsonb_build_object('token', null, 'error', 'wrong_pin', 'tries_left', c_device_limit - v_device_fails);
  end if;

  -- Correct PIN: forgive this device's earlier typos.
  delete from admin_login_failures where device_id = v_device;
  insert into admin_sessions (token, expires_at) values (gen_random_uuid(), now() + interval '12 hours') returning token into v_token;
  return jsonb_build_object('token', v_token, 'error', null);
end;
$function$;

grant execute on function public.admin_login(text, text) to anon;

-- ============ 6. reverse_geocode: same behaviour, bounded cache growth ============
-- Cached answers are still served with no limit. Only NEW lookups (external calls and new
-- cache rows) are capped at 1000 per hour; beyond that the label is simply left blank.
create or replace function public.reverse_geocode(p_lat numeric, p_lon numeric)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_lat_key numeric(8,4) := round(p_lat, 4);
  v_lon_key numeric(8,4) := round(p_lon, 4);
  v_label text;
  v_resp extensions.http_response;
  v_url text;
begin
  select label into v_label from geocode_cache where lat_key = v_lat_key and lon_key = v_lon_key;
  if v_label is not null then
    return v_label;
  end if;

  if (select count(*) from geocode_cache where cached_at > now() - interval '1 hour') >= 1000 then
    return null;
  end if;

  v_url := format(
    'https://nominatim.openstreetmap.org/reverse?format=json&lat=%s&lon=%s&zoom=16&addressdetails=1',
    p_lat, p_lon
  );

  begin
    select * into v_resp from extensions.http((
      'GET', v_url,
      array[extensions.http_header('User-Agent', 'EcosteHRMS/1.0 (support16@ecoste.in)')],
      null, null
    )::extensions.http_request);
  exception when others then
    -- A geocoded label is a convenience, never the reason a punch fails.
    return null;
  end;

  if v_resp.status is distinct from 200 then
    return null;
  end if;

  v_label := v_resp.content::jsonb ->> 'display_name';
  if v_label is not null then
    insert into geocode_cache (lat_key, lon_key, label) values (v_lat_key, v_lon_key, v_label)
      on conflict (lat_key, lon_key) do update set label = excluded.label, cached_at = now();
  end if;

  return v_label;
end;
$function$;

-- ============ 7. Trigger-only functions and the unused balance editor ============
-- Triggers still fire without EXECUTE; these were only ever reachable by mistake.
revoke execute on function public.archive_deleted_travel_visits() from public, anon, authenticated;
revoke execute on function public.refresh_attendance_monthly_summary() from public, anon, authenticated;
revoke execute on function public.leave_balance_editor_update() from public, anon, authenticated;
revoke all on public.leave_balance_editor from public, anon, authenticated;

-- ============ 8. Table rights the app never uses ============
-- Row-level security already blocks row reads/writes through the API; TRUNCATE is NOT
-- covered by row-level security, so it is removed explicitly. The app only reads and
-- writes through RPCs, views and storage.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on table public.%I from public, anon, authenticated', r.tablename);
  end loop;
end $$;
