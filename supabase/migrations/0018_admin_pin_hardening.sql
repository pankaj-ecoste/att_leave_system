-- Day 3 evening — admin PIN old-PIN check (plan.md §8C, PROGRESS.md P6-5).
--
-- admin_update_settings could change the admin PIN with nothing but a valid session
-- token — no proof the caller actually knows the current PIN. Anyone at an unlocked
-- admin session (a shared screen, a forgotten logout) could silently lock the real
-- admin out. The "confirm new PIN" half of P6-5 is a client-side check (two fields
-- must match before the request is even sent) — nothing for the database to enforce
-- there since it never sees an unconfirmed value.

-- CREATE OR REPLACE with a different argument list creates a new overload rather than
-- replacing the old one — Postgres identifies functions by name *and* parameter types,
-- not name alone. Without this, the original 3-argument admin_update_settings(uuid,
-- numeric, text) would keep existing untouched alongside the new one, fully granted and
-- with no old-PIN check at all, a live bypass right next to the fix.
drop function if exists public.admin_update_settings(uuid, numeric, text);

create or replace function public.admin_update_settings(
  p_token uuid, p_std_hours numeric, p_new_admin_pin text default null::text, p_old_pin text default null::text
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
    select admin_pin_hash into v_current_hash from app_settings where id = 1;
    if p_old_pin is null or crypt(p_old_pin, v_current_hash) is distinct from v_current_hash then
      raise exception 'Current PIN is incorrect';
    end if;
    update app_settings set std_hours = p_std_hours, admin_pin_hash = crypt(p_new_admin_pin, gen_salt('bf')) where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours || ', admin pin changed', 'admin');
  else
    update app_settings set std_hours = p_std_hours where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours, 'admin');
  end if;
  return true;
end;
$function$;

-- Explicit, not relying on Supabase's default-privilege bootstrap alone (the same gotcha
-- that let log_audit and run_annual_leave_rollover be called directly by anon until
-- 0014 fixed it) — a new overload starts with its own privileges, and this one guards
-- the admin PIN, so it gets an explicit grant rather than an assumption.
grant execute on function public.admin_update_settings(uuid, numeric, text, text) to anon;
