-- HR request (2026-08-17), plan.md §12 V3 decision 7 — office locations should display
-- as their site name (ECOSTE / MetaMask / PLANT SONIPAT HARYANA), not the full
-- reverse-geocoded address text. Field/WFH staff keep showing the full address, as a
-- natural consequence of the rule rather than a special case: their GPS pings are
-- essentially never inside a known site's radius, so nearest_active_site never matches
-- for them. Reuses the existing nearest_active_site() function (0007_geofence_and_wfh.sql)
-- — same geofence math employee_punch already uses, applied here at read time so it
-- covers every location_logs row, not just punches (the 2-hourly auto-tracking pings too).

drop function if exists public.admin_get_all_location_logs(uuid, date);

create or replace function public.admin_get_all_location_logs(p_token uuid, p_date date)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone, lat numeric, lon numeric, accuracy_m numeric, site_name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at, l.lat, l.lon, l.accuracy_m,
      case when l.lat is not null and l.lon is not null then
        (select ns.site_name from nearest_active_site(l.lat, l.lon) ns where ns.distance_m <= ns.radius_m limit 1)
      end as site_name
    from location_logs l join employees e on e.id = l.emp_id
    where l.date = p_date order by l.captured_at desc;
end;
$function$;

-- Same drop-then-recreate reason as admin_get_all_location_logs above — plain
-- create-or-replace can't change a RETURNS TABLE column list.
drop function if exists public.manager_get_team_location_logs(uuid, uuid, date);

create or replace function public.manager_get_team_location_logs(p_token uuid, p_manager_id uuid, p_date date)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone, lat numeric, lon numeric, accuracy_m numeric, site_name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at, l.lat, l.lon, l.accuracy_m,
      case when l.lat is not null and l.lon is not null then
        (select ns.site_name from nearest_active_site(l.lat, l.lon) ns where ns.distance_m <= ns.radius_m limit 1)
      end as site_name
    from location_logs l join employees e on e.id = l.emp_id
    where e.manager_emp_id = p_manager_id and l.date = p_date
    order by l.captured_at desc;
end;
$function$;

grant execute on function public.manager_get_team_location_logs(uuid, uuid, date) to anon;
