-- Follow-up to 0034 (plan.md §15.1) — same bug class, two more places. Admin asked to
-- confirm this class of error can't recur; auditing every function that writes
-- attendance/location data found employee_log_location and employee_log_od_location
-- also took `date` straight from the client's phone clock, unvalidated, same as
-- employee_punch did. Live data already had two real mismatches caused by this:
-- Rahul Das's location_logs row dated 2 days off from its actual captured_at, and
-- Ashish Singh's od_tracking_logs row dated 1 day off from its actual ts. Fixed the
-- same way: the server now derives `date` from its own clock (captured_at/ts, both
-- already `now()`-defaulted) instead of trusting `p_date`. The `p_date` parameter is
-- kept (not removed) so the existing client call signature doesn't need to change —
-- its value is simply no longer used.

create or replace function public.employee_log_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text default 'auto'::text, p_lat numeric default null::numeric, p_lon numeric default null::numeric, p_accuracy_m numeric default null::numeric)
 returns location_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row location_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  insert into location_logs(emp_id, date, lat_lon, type, lat, lon, accuracy_m)
    values(p_emp_id, (now() at time zone 'Asia/Kolkata')::date, p_lat_lon, p_type, p_lat, p_lon, p_accuracy_m)
    returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.employee_log_od_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_lat numeric default null::numeric, p_lon numeric default null::numeric, p_accuracy_m numeric default null::numeric)
 returns od_tracking_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row od_tracking_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into od_tracking_logs (emp_id, date, lat_lon, lat, lon, accuracy_m)
    values (p_emp_id, (now() at time zone 'Asia/Kolkata')::date, p_lat_lon, p_lat, p_lon, p_accuracy_m)
    returning * into v_row;
  return v_row;
end;
$function$;
