-- plan.md §38 — a few staff keep getting "this is not your registered device" while
-- swearing it is the same phone and browser. The device id is a number kept in browser
-- storage that a phone can silently lose, so the server cannot tell "same phone, id lost"
-- from "someone else's phone". The app now keeps the id in several places (front-end), and
-- sends a short note with each login saying how the app was opened and whether the id was
-- new / restored / known. This migration only RECORDS that note in the audit log — the
-- decision logic (bind on first login, deny on mismatch) is byte-for-byte what 0039 does.
--
-- Backward compatibility (the §19 stale-client lesson): the new parameter has a DEFAULT, and
-- the old 3-argument version is dropped in the same migration, so a phone still running the
-- pre-deploy app keeps logging in with its 3 named arguments — there is never a moment where
-- a login signature disappears.

create or replace function public.employee_login(p_employee_id uuid, p_pin text, p_device_id text, p_device_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pin_hash text; v_active boolean; v_attempts int; v_locked_until timestamptz; v_token uuid;
  v_bound_device_id text; v_name text; v_note text; v_suffix text;
begin
  -- The note is client-supplied text going into the audit log: keep only plain characters
  -- and cap the length, so it can't be used to stuff junk into the log.
  v_note := left(regexp_replace(coalesce(p_device_note, ''), '[^A-Za-z0-9 ;:._()/-]', '', 'g'), 120);
  v_suffix := case when v_note <> '' then ' [' || v_note || ']' else '' end;

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

  -- Correct PIN confirmed — now check the registered device (only after auth succeeds, so a
  -- wrong-PIN guess can't probe whether a device is bound — same as 0039).
  if v_bound_device_id is null then
    if nullif(p_device_id, '') is not null then
      update employees set punch_device_id = p_device_id, punch_device_bound_at = now() where id = p_employee_id;
      perform log_audit('LOGIN_DEVICE_BOUND', v_name || ' — device registered at login' || v_suffix, 'system');
    end if;
  elsif v_bound_device_id <> coalesce(p_device_id, '') then
    perform log_audit('LOGIN_DEVICE_BLOCKED', v_name || ' — login blocked, different device than registered' || v_suffix, 'system');
    return jsonb_build_object('token', null, 'error', 'device_denied');
  elsif position('restored-from' in v_note) > 0 then
    -- Right device, and the app brought the id back from a backup copy after the main one was
    -- wiped — i.e. someone who WOULD have been blocked before. Worth being able to count.
    perform log_audit('LOGIN_DEVICE_RESTORED', v_name || ' — device id restored from backup storage' || v_suffix, 'system');
  end if;

  update employees set failed_pin_attempts = 0, locked_until = null where id = p_employee_id;
  insert into employee_sessions (emp_id) values (p_employee_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'error', null);
end;
$function$;

grant execute on function public.employee_login(uuid, text, text, text) to anon;

drop function if exists public.employee_login(uuid, text, text);

notify pgrst, 'reload schema';
