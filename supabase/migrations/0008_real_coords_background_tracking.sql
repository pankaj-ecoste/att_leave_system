-- Day 2 morning (continued) — real numbers for the *silent background* tracking too.
-- 0007 fixed this for the punch itself (attendance.in_lat/in_lon/...); location_logs
-- (the 2-hourly-while-punched-in ping, plan.md Decision 5) and od_tracking_logs (the
-- 5-minutely-while-On-Duty ping) were still only ever given the reverse-geocoded
-- address text — plan.md's "store the real numbers... the address as a cached label
-- only" wasn't actually true for either of these two tables. Fixed here: `lat_lon`
-- stays exactly what it already is, a display label; lat/lon/accuracy_m are new,
-- real, numeric, and what any future fraud-check (plan.md's X-3, "impossible travel",
-- "identical coordinates") would actually compute against.

alter table location_logs add column if not exists lat numeric(9,6);
alter table location_logs add column if not exists lon numeric(9,6);
alter table location_logs add column if not exists accuracy_m numeric;

alter table od_tracking_logs add column if not exists lat numeric(9,6);
alter table od_tracking_logs add column if not exists lon numeric(9,6);
alter table od_tracking_logs add column if not exists accuracy_m numeric;

-- Drop the old signatures first rather than relying on `create or replace` to widen
-- them — PostgREST resolves overloads by exact argument match, and a caller sending
-- only the original 5 (or 4) named args would otherwise be "ambiguous" between the old
-- and new signature instead of cleanly hitting one function. This guarantees exactly
-- one signature exists for each afterward, same reasoning as fetch_directory in 0005.

drop function if exists public.employee_log_location(uuid, uuid, text, date, text);
drop function if exists public.employee_log_od_location(uuid, uuid, text, date);

create or replace function public.employee_log_location(
  p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text default 'auto'::text,
  p_lat numeric default null, p_lon numeric default null, p_accuracy_m numeric default null
)
 returns location_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row location_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  insert into location_logs(emp_id, date, lat_lon, type, lat, lon, accuracy_m)
    values(p_emp_id, p_date, p_lat_lon, p_type, p_lat, p_lon, p_accuracy_m)
    returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.employee_log_od_location(
  p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date,
  p_lat numeric default null, p_lon numeric default null, p_accuracy_m numeric default null
)
 returns od_tracking_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row od_tracking_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into od_tracking_logs (emp_id, date, lat_lon, lat, lon, accuracy_m)
    values (p_emp_id, p_date, p_lat_lon, p_lat, p_lon, p_accuracy_m)
    returning * into v_row;
  return v_row;
end;
$function$;

grant execute on function public.employee_log_location(uuid, uuid, text, date, text, numeric, numeric, numeric) to anon;
grant execute on function public.employee_log_od_location(uuid, uuid, text, date, numeric, numeric, numeric) to anon;

-- Explicit column list, so it needs the drop-then-recreate (same reason as
-- fetch_directory in 0005 — Postgres refuses to change a RETURNS TABLE column list
-- with plain create-or-replace).
drop function if exists public.admin_get_all_location_logs(uuid, date);

create or replace function public.admin_get_all_location_logs(p_token uuid, p_date date)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone, lat numeric, lon numeric, accuracy_m numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at, l.lat, l.lon, l.accuracy_m
    from location_logs l join employees e on e.id = l.emp_id
    where l.date = p_date order by l.captured_at desc;
end;
$function$;
