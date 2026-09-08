-- plan.md §19 — 0038 only blocked the *punch* action; HR now wants a shared PIN to be
-- useless even just to open the panel. Extends the same device-binding columns from
-- 0038 (employees.punch_device_id / punch_device_bound_at) to employee_login: the
-- first device that logs in for an employee becomes the only device that can log in
-- (or punch) from then on. A colleague using a borrowed PIN gets denied at login,
-- before ever seeing the dashboard — not just blocked at the punch button.

create or replace function public.employee_login(p_employee_id uuid, p_pin text, p_device_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pin_hash text; v_active boolean; v_attempts int; v_locked_until timestamptz; v_token uuid;
  v_bound_device_id text; v_name text;
begin
  select pin, active, failed_pin_attempts, locked_until, punch_device_id, name
    into v_pin_hash, v_active, v_attempts, v_locked_until, v_bound_device_id, v_name
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

  -- Correct PIN confirmed — now check the registered device. Checked only after auth
  -- succeeds, so a wrong-PIN guess can't be used to probe whether a device is already
  -- bound to someone else's account.
  if v_bound_device_id is null then
    if nullif(p_device_id, '') is not null then
      update employees set punch_device_id = p_device_id, punch_device_bound_at = now() where id = p_employee_id;
      perform log_audit('LOGIN_DEVICE_BOUND', v_name || ' — device registered at login', 'system');
    end if;
  elsif v_bound_device_id <> coalesce(p_device_id, '') then
    perform log_audit('LOGIN_DEVICE_BLOCKED', v_name || ' — login blocked, different device than registered', 'system');
    return jsonb_build_object('token', null, 'error', 'device_denied');
  end if;

  update employees set failed_pin_attempts = 0, locked_until = null where id = p_employee_id;
  insert into employee_sessions (emp_id) values (p_employee_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'error', null);
end;
$function$;

grant execute on function public.employee_login(uuid, text, text) to anon;

-- Old 2-arg employee_login is superseded — same reasoning as 0038 dropping the old
-- 3-arg employee_punch — drop it so there's exactly one signature and no risk of the
-- app (or a stale client) calling the unbound-check version.
drop function if exists public.employee_login(uuid, text);

-- HR chose to force this immediately rather than let existing "remember me" sessions
-- expire naturally over up to 30 days (plan.md §19) — every employee has to enter
-- their PIN once more today, but the new device check then applies to 100% of staff
-- from the moment this ships, not just whoever's session happens to expire first.
-- Admin sessions are untouched — out of scope, same as 0034.
delete from public.employee_sessions;
