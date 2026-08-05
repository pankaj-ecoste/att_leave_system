-- Day 3 afternoon item pulled forward — manager's view of their own team's location
-- log (plan.md Phase 3, P3-15). Same posture as manager_get_team_attendance: scoped to
-- direct reports only (`e.manager_emp_id = p_manager_id`), not every employee — that's
-- what makes this safe to expose to a manager token rather than requiring admin.

create or replace function public.manager_get_team_location_logs(p_token uuid, p_manager_id uuid, p_date date)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone, lat numeric, lon numeric, accuracy_m numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at, l.lat, l.lon, l.accuracy_m
    from location_logs l join employees e on e.id = l.emp_id
    where e.manager_emp_id = p_manager_id and l.date = p_date
    order by l.captured_at desc;
end;
$function$;

grant execute on function public.manager_get_team_location_logs(uuid, uuid, date) to anon;
