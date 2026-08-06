-- P4-6 (revised, 2026-08-06): real transactional email (Resend + DNS on ecoste.in) stays
-- deferred indefinitely — Q-2/Q-3 were never answered, and the manager/admin panels
-- already show pending leaves live the moment either logs in, so a server-sent email was
-- only ever a nudge, not the data channel itself. Replacing it with a mailto: link on
-- the staff panel: the employee's own mail client sends the nudge to the manager +
-- this one admin notification address, no DNS or email-provider account required.

alter table app_settings add column if not exists admin_email text;

-- CREATE OR REPLACE with a new argument list creates a new overload rather than
-- replacing the old one (the same gotcha 0018's comment already documents for this
-- exact function) — drop the current 4-argument signature explicitly first.
drop function if exists public.admin_update_settings(uuid, numeric, text, text);

create or replace function public.admin_update_settings(
  p_token uuid, p_std_hours numeric, p_new_admin_pin text default null::text,
  p_old_pin text default null::text, p_admin_email text default null::text
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
    update app_settings set
      std_hours = p_std_hours,
      admin_pin_hash = crypt(p_new_admin_pin, gen_salt('bf')),
      admin_email = coalesce(p_admin_email, admin_email)
      where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours || ', admin pin changed', 'admin');
  else
    update app_settings set
      std_hours = p_std_hours,
      admin_email = coalesce(p_admin_email, admin_email)
      where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours, 'admin');
  end if;
  return true;
end;
$function$;

grant execute on function public.admin_update_settings(uuid, numeric, text, text, text) to anon;

-- admin_email needs to be anon-readable (no token) so the employee's Apply Leave screen
-- can build the notify-by-email link — same posture as std_hours already has here, and
-- no more sensitive than the manager email already shown in that same screen.
create or replace view public.app_settings_public as
  select std_hours, admin_email from app_settings where id = 1;
