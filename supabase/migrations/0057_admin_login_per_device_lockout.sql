-- plan.md §37 — the admin PIN lockout was ONE shared counter for the whole company
-- (app_settings.admin_failed_attempts / admin_locked_until, id = 1). The admin login link
-- sits on the public staff screen, so a staff member who tapped it by mistake and typed 3
-- wrong PINs locked the real admin out for 20 minutes (and anyone could do it on purpose).
--
-- Three layers, all enforced here in the database:
--   1. PER-DEVICE lock — 3 wrong PINs lock only the device that typed them, 20 minutes.
--   2. COMPANY-WIDE safety cap — 30 wrong PINs from ALL devices inside 20 minutes locks the
--      admin login for everyone. A device id lives in the browser (clearable), so layer 1
--      alone could be dodged by wiping browser data between guesses; this stops a real
--      guessing attack while being far above what accidental staff mistakes ever reach.
--   3. The answer now says WHY and WHEN (wrong_pin + tries_left / locked + locked_until),
--      same shape as employee_login, instead of one vague "wrong or locked" message.
--
-- Each wrong guess is a row (device_id, failed_at) and "locked" is DERIVED from the rows in
-- the last 20 minutes — no counters to forget to reset, nothing to get stuck. Attempts made
-- while locked are rejected WITHOUT being recorded, so a lock can never extend itself.
-- An advisory lock serialises admin_login calls so parallel guesses can't all be checked
-- before any of them is counted.

create table if not exists public.admin_login_failures (
  id        bigint generated always as identity primary key,
  device_id text not null,
  failed_at timestamptz not null default now()
);
create index if not exists idx_admin_login_failures_device on public.admin_login_failures (device_id, failed_at desc);
create index if not exists idx_admin_login_failures_time   on public.admin_login_failures (failed_at desc);

-- Same lock-down as every other internal table (0052): RLS on, no policies, no direct grants.
alter table public.admin_login_failures enable row level security;
revoke all on table public.admin_login_failures from anon, authenticated;

-- When does the lock on this scope end? NULL = not locked.
-- p_device = a device id, or NULL for the company-wide scope. p_limit = failures that lock it.
-- Locked means "p_limit or more failures in the last 20 minutes"; it unlocks when the
-- p_limit-th most recent failure turns 20 minutes old.
create or replace function public._admin_login_unlock_at(p_device text, p_limit int)
 returns timestamptz
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select t.failed_at + interval '20 minutes'
  from (
    select failed_at, row_number() over (order by failed_at desc) as rn
    from admin_login_failures
    where failed_at > now() - interval '20 minutes'
      and (p_device is null or device_id = p_device)
  ) t
  where t.rn = p_limit;
$function$;
revoke execute on function public._admin_login_unlock_at(text, int) from public, anon, authenticated;

create or replace function public.admin_login(p_pin text, p_device_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  c_device_limit constant int := 3;
  c_global_limit constant int := 30;
  v_device text := left(coalesce(nullif(trim(p_device_id), ''), 'unknown'), 64);
  v_hash text; v_token uuid; v_until timestamptz; v_device_fails int;
begin
  perform pg_advisory_xact_lock(hashtext('admin_login'));
  delete from admin_login_failures where failed_at < now() - interval '1 hour';

  -- Already locked? Reject WITHOUT counting this attempt.
  v_until := _admin_login_unlock_at(v_device, c_device_limit);
  if v_until is not null then
    return jsonb_build_object('token', null, 'error', 'locked', 'locked_until', v_until, 'tries_left', 0);
  end if;
  v_until := _admin_login_unlock_at(null, c_global_limit);
  if v_until is not null then
    return jsonb_build_object('token', null, 'error', 'locked_global', 'locked_until', v_until, 'tries_left', 0);
  end if;

  select admin_pin_hash into v_hash from app_settings where id = 1;
  if v_hash is null or v_hash <> crypt(p_pin, v_hash) then
    insert into admin_login_failures (device_id) values (v_device);

    -- Did THIS wrong PIN just trip a lock? Log it once, at the moment it happens.
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

-- The 1-argument version (shared counter) is superseded — drop it so there is exactly one
-- signature and no stale client can reach the old everyone-locks-everyone path. Same
-- reasoning as 0039 dropping the old 2-arg employee_login.
drop function if exists public.admin_login(text);

-- The old shared counter is dead now; clear it so a lock that was active when this
-- shipped can't linger in the (now unused) columns.
update public.app_settings set admin_failed_attempts = 0, admin_locked_until = null where id = 1;
