-- Tighten PIN lockout (2026-08-07, your call): 5 tries/15 min was too lenient for a
-- 4-character PIN — 3 tries/20 min for both employee logins and the shared admin PIN.
-- Same parameter list as before, so this replaces in place (no overload risk).

create or replace function public.employee_login(p_employee_id uuid, p_pin text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pin_hash text; v_active boolean; v_attempts int; v_locked_until timestamptz; v_token uuid;
begin
  select pin, active, failed_pin_attempts, locked_until
    into v_pin_hash, v_active, v_attempts, v_locked_until
    from employees where id = p_employee_id;

  if v_pin_hash is null or not v_active then
    return jsonb_build_object('token', null, 'error', 'not_found');
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object('token', null, 'error', 'locked', 'locked_until', v_locked_until);
  end if;

  if v_pin_hash <> crypt(p_pin, v_pin_hash) then
    update employees set
      failed_pin_attempts = failed_pin_attempts + 1,
      locked_until = case when failed_pin_attempts + 1 >= 3 then now() + interval '20 minutes' else locked_until end
      where id = p_employee_id;
    return jsonb_build_object('token', null, 'error', 'wrong_pin');
  end if;

  update employees set failed_pin_attempts = 0, locked_until = null where id = p_employee_id;
  insert into employee_sessions (emp_id) values (p_employee_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'error', null);
end;
$function$;

create or replace function public.admin_login(p_pin text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_hash text; v_locked_until timestamptz; v_token uuid;
begin
  select admin_pin_hash, admin_locked_until into v_hash, v_locked_until from app_settings where id = 1;
  if v_locked_until is not null and v_locked_until > now() then return null; end if;
  if v_hash is null or v_hash <> crypt(p_pin, v_hash) then
    update app_settings set
      admin_failed_attempts = admin_failed_attempts + 1,
      admin_locked_until = case when admin_failed_attempts + 1 >= 3 then now() + interval '20 minutes' else admin_locked_until end
      where id = 1;
    return null;
  end if;
  update app_settings set admin_failed_attempts = 0, admin_locked_until = null where id = 1;
  insert into admin_sessions (token, expires_at) values (gen_random_uuid(), now() + interval '12 hours') returning token into v_token;
  return v_token;
end;
$function$;
