-- plan.md §28 follow-up (2026-09-22, admin feedback after Puneet Sharma's first real
-- use of the feature) — the map already draws punch-in -> visits -> punch-out as a
-- connected line (JourneyMap.jsx), but the on-screen list and the downloadable report
-- only showed the visit rows, not the punch-in/punch-out bookends the map implies.
-- Fixing the presentation, not the underlying data/math, which checked out correctly
-- against Puneet's real 2026-09-21 journey (punch-in -> Supernova -> punch-out =
-- 19.73km, confirmed by hand against the stored coordinates).
--
-- Only one new function needed: admin already has adminFetchAttendance(empId, from,
-- to) for this; manager has no per-team-member date-range attendance fetch (only a
-- whole-team, whole-month one used by the Attendance tab), so this adds a narrow one,
-- scoped and shaped exactly like the existing manager_get_team_travel_journey's
-- ownership check.

create or replace function public.manager_get_team_travel_attendance(p_token uuid, p_manager_id uuid, p_emp_id uuid, p_from date, p_to date)
 returns setof attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if not exists (select 1 from employees where id = p_emp_id and manager_emp_id = p_manager_id) then
    raise exception 'Not your team member';
  end if;
  return query
    select a.* from attendance a
    where a.emp_id = p_emp_id and a.date >= p_from and a.date <= p_to
    order by a.date;
end;
$function$;

grant execute on function public.manager_get_team_travel_attendance(uuid, uuid, uuid, date, date) to anon;
