-- plan.md §28/§31 follow-up (2026-09-22) — "staff frontend shows a different distance
-- than admin panel" (correct catch). Refinement only ran when ADMIN opened Review, so
-- between the employee saving a visit and admin next reviewing it, the employee's own
-- screen kept showing the old straight-line estimate while admin's (once refined) would
-- show the real road distance — two different numbers for the same trip, which looks
-- like a bug even though both were "correct" for their moment.
--
-- Fix: pull the batch-refine loop out of admin_refine_travel_distances into a private
-- core function (no token check, NOT anon-granted — would let anyone refine anyone's
-- distances without auth if it were), and add an employee-scoped wrapper with its own
-- token check. The client now fires this right after saving a visit (fire-and-forget,
-- never blocks the "visit saved" confirmation — same "an accuracy convenience, never
-- the reason anything fails" posture as the ORS call itself). Admin's review still
-- triggers the same core logic too, as a backstop for the rare case the employee's
-- background refine didn't get a chance to run. Both wrappers write into the exact same
-- columns, so whichever side refines first, the other side reads the identical number
-- on its next load — there's no longer a separate "admin's number" and "employee's
-- number", just one number that starts as an estimate and gets more accurate in place.

create or replace function public.travel_refine_distances_core(p_emp_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count int := 0;
  v_rec record;
  v_day record;
  v_prev_lat numeric; v_prev_lon numeric;
  v_km numeric;
begin
  for v_rec in
    select v.id, v.date, v.lat, v.lon, v.captured_at
    from travel_visits v
    where v.emp_id = p_emp_id and v.road_leg_km is null and not v.distance_overridden
    order by v.date, v.captured_at
  loop
    select vv.lat, vv.lon into v_prev_lat, v_prev_lon
      from travel_visits vv
      where vv.emp_id = p_emp_id and vv.date = v_rec.date and vv.captured_at < v_rec.captured_at
      order by vv.captured_at desc limit 1;
    if v_prev_lat is null then
      select in_lat, in_lon into v_prev_lat, v_prev_lon from attendance where emp_id = p_emp_id and date = v_rec.date;
    end if;
    if v_prev_lat is not null then
      v_km := road_distance_km(v_prev_lat, v_prev_lon, v_rec.lat, v_rec.lon);
      if v_km is not null then
        update travel_visits set road_leg_km = v_km where id = v_rec.id;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  for v_day in
    select a.date, a.out_lat, a.out_lon
    from attendance a
    where a.emp_id = p_emp_id and a.out_lat is not null and a.travel_return_road_km is null
      and exists (select 1 from travel_visits v where v.emp_id = p_emp_id and v.date = a.date)
  loop
    select v.lat, v.lon into v_prev_lat, v_prev_lon
      from travel_visits v where v.emp_id = p_emp_id and v.date = v_day.date
      order by v.captured_at desc limit 1;
    if v_prev_lat is not null then
      v_km := road_distance_km(v_prev_lat, v_prev_lon, v_day.out_lat, v_day.out_lon);
      if v_km is not null then
        update attendance set travel_return_road_km = v_km where emp_id = p_emp_id and date = v_day.date;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$function$;

-- admin_refine_travel_distances now just delegates — behaviour unchanged, body shrinks
-- to the token check plus one call.
create or replace function public.admin_refine_travel_distances(p_token uuid, p_emp_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return travel_refine_distances_core(p_emp_id);
end;
$function$;

create or replace function public.employee_refine_own_travel_distances(p_token uuid, p_emp_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return travel_refine_distances_core(p_emp_id);
end;
$function$;

grant execute on function public.employee_refine_own_travel_distances(uuid, uuid) to anon;
