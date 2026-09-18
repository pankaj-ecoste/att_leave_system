-- plan.md §28 follow-up (2026-09-18, admin feedback after first click-through) —
-- 1) optional additional-expense (toll/lunch/etc.) per visit, receipt photo mandatory
--    the moment an expense is entered
-- 2) travel_summary_for_employee and everything built on it now also carries the
--    running expense total, so admin's day-wise/cumulative report and the settlement
--    amount can include it
--
-- Same posture as 0045: this only touches functions THIS feature created a few hours
-- ago in 0044, never a pre-existing production function.

-- ============ 1. travel_visits — optional expense columns ============
-- Nullable: most visits have no extra expense. The "photo mandatory if entered" rule
-- is enforced in employee_add_travel_visit below, not a table CHECK constraint, since
-- it needs the "OR"-across-two-columns logic a simple check can express but reads more
-- clearly as a raised exception with a real message, matching every other validation in
-- this file.

alter table travel_visits add column if not exists expense_note text;
alter table travel_visits add column if not exists expense_amount numeric;
alter table travel_visits add column if not exists expense_photo_path text;

-- ============ 2. travel_settlements — itemized expense total on top of distance pay ============

alter table travel_settlements add column if not exists expense_amount numeric not null default 0;

-- ============ 3. employee_add_travel_visit — accept + validate the optional expense ============
-- New trailing params, all defaulted, so this stays call-compatible with itself.

drop function if exists public.employee_add_travel_visit(uuid, uuid, date, numeric, numeric, numeric, text, text);

create or replace function public.employee_add_travel_visit(
  p_token uuid, p_emp_id uuid, p_date date, p_lat numeric, p_lon numeric,
  p_accuracy_m numeric, p_site_note text, p_photo_path text,
  p_expense_note text default null, p_expense_amount numeric default null, p_expense_photo_path text default null
)
 returns travel_visits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_work_mode text;
  v_in_lat numeric; v_in_lon numeric; v_has_punched_in boolean; v_still_in boolean;
  v_prev_lat numeric; v_prev_lon numeric;
  v_leg_km numeric;
  v_has_expense boolean;
  v_row travel_visits;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  if p_site_note is null or btrim(p_site_note) = '' then raise exception 'Site/client name is required'; end if;
  if p_photo_path is null or btrim(p_photo_path) = '' then raise exception 'Selfie photo is required'; end if;

  v_has_expense := (p_expense_note is not null and btrim(p_expense_note) <> '') or p_expense_amount is not null;
  if v_has_expense then
    if p_expense_amount is null or p_expense_amount <= 0 then
      raise exception 'Enter a valid expense amount';
    end if;
    if p_expense_photo_path is null or btrim(p_expense_photo_path) = '' then
      raise exception 'A receipt photo is required when logging an additional expense';
    end if;
  end if;

  select work_mode into v_work_mode from employees where id = p_emp_id;
  if v_work_mode is null or v_work_mode not in ('field', 'both') then
    raise exception 'Travel journey logging is only available for Field / Office+Field staff';
  end if;

  select in_lat, in_lon, (in_time is not null), (out_time is null)
    into v_in_lat, v_in_lon, v_has_punched_in, v_still_in
    from attendance where emp_id = p_emp_id and date = p_date;

  if not coalesce(v_has_punched_in, false) then
    raise exception 'Punch in before logging a site visit';
  end if;
  if not coalesce(v_still_in, false) then
    raise exception 'Already punched out for this date';
  end if;

  select v.lat, v.lon into v_prev_lat, v_prev_lon
    from travel_visits v where v.emp_id = p_emp_id and v.date = p_date
    order by v.captured_at desc limit 1;

  if v_prev_lat is null then
    v_prev_lat := v_in_lat;
    v_prev_lon := v_in_lon;
  end if;

  v_leg_km := coalesce(haversine_m(v_prev_lat, v_prev_lon, p_lat, p_lon) / 1000.0, 0);

  insert into travel_visits (
    emp_id, date, lat, lon, accuracy_m, site_note, photo_path, leg_distance_km,
    expense_note, expense_amount, expense_photo_path
  )
    values (
      p_emp_id, p_date, p_lat, p_lon, p_accuracy_m, btrim(p_site_note), p_photo_path, v_leg_km,
      nullif(btrim(coalesce(p_expense_note, '')), ''), p_expense_amount, p_expense_photo_path
    )
    returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.employee_add_travel_visit(uuid, uuid, date, numeric, numeric, numeric, text, text, text, numeric, text) to anon;

-- ============ 4. travel_summary_for_employee — add total_expense ============
-- Return-shape change (drop+recreate, same reason 0036 dropped fetch_directory).

drop function if exists public.travel_summary_for_employee(uuid);

create or replace function public.travel_summary_for_employee(p_emp_id uuid)
 returns table(total_km numeric, total_expense numeric, visit_count integer, first_date date, last_date date)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with last_visit_per_day as (
    select distinct on (v.date) v.date, v.lat, v.lon
    from travel_visits v where v.emp_id = p_emp_id
    order by v.date, v.captured_at desc
  ), return_legs as (
    select coalesce(haversine_m(lv.lat, lv.lon, a.out_lat, a.out_lon) / 1000.0, 0) as km
    from last_visit_per_day lv
    join attendance a on a.emp_id = p_emp_id and a.date = lv.date
    where a.out_lat is not null and a.out_lon is not null
  )
  select
    coalesce((select sum(v.leg_distance_km) from travel_visits v where v.emp_id = p_emp_id), 0)
      + coalesce((select sum(km) from return_legs), 0) as total_km,
    coalesce((select sum(v.expense_amount) from travel_visits v where v.emp_id = p_emp_id), 0) as total_expense,
    (select count(*)::int from travel_visits v where v.emp_id = p_emp_id) as visit_count,
    (select min(v.date) from travel_visits v where v.emp_id = p_emp_id) as first_date,
    (select max(v.date) from travel_visits v where v.emp_id = p_emp_id) as last_date;
$function$;

-- ============ 5. employee_get_travel_summary — return-shape change, drop+recreate ============

drop function if exists public.employee_get_travel_summary(uuid, uuid);

create or replace function public.employee_get_travel_summary(p_token uuid, p_emp_id uuid)
 returns table(total_km numeric, total_expense numeric, visit_count integer, first_date date, last_date date)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from travel_summary_for_employee(p_emp_id);
end;
$function$;

grant execute on function public.employee_get_travel_summary(uuid, uuid) to anon;

-- ============ 6. manager_get_team_travel_summary — add total_expense, drop+recreate ============

drop function if exists public.manager_get_team_travel_summary(uuid, uuid);

create or replace function public.manager_get_team_travel_summary(p_token uuid, p_manager_id uuid)
 returns table(emp_id uuid, emp_name text, emp_num text, ta_rate_tier text, total_km numeric, total_expense numeric, visit_count integer, first_date date, last_date date)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select e.id, e.name, e.emp_num, e.ta_rate_tier, s.total_km, s.total_expense, s.visit_count, s.first_date, s.last_date
    from employees e
    cross join lateral travel_summary_for_employee(e.id) s
    where e.manager_emp_id = p_manager_id and e.work_mode in ('field', 'both')
      and e.deleted_at is null and e.active
    order by e.name;
end;
$function$;

grant execute on function public.manager_get_team_travel_summary(uuid, uuid) to anon;

-- ============ 7. admin_get_travel_overview — add total_expense, drop+recreate ============

drop function if exists public.admin_get_travel_overview(uuid);

create or replace function public.admin_get_travel_overview(p_token uuid)
 returns table(emp_id uuid, emp_name text, emp_num text, work_mode text, ta_rate_tier text, total_km numeric, total_expense numeric, visit_count integer, first_date date, last_date date)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select e.id, e.name, e.emp_num, e.work_mode, e.ta_rate_tier, s.total_km, s.total_expense, s.visit_count, s.first_date, s.last_date
    from employees e
    cross join lateral travel_summary_for_employee(e.id) s
    where e.work_mode in ('field', 'both') and e.deleted_at is null and e.active
    order by e.name;
end;
$function$;

grant execute on function public.admin_get_travel_overview(uuid) to anon;

-- ============ 8. admin_settle_travel_period — pay distance + expense together, itemized ============
-- Same declared return signature as before (table(settlement travel_settlements,
-- photo_paths text[])) — travel_settlements is referenced by type name, not an
-- explicit column list, so it automatically picks up expense_amount without this
-- signature needing to change; plain create or replace is enough here.

create or replace function public.admin_settle_travel_period(p_token uuid, p_emp_id uuid)
 returns table(settlement travel_settlements, photo_paths text[])
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_summary record;
  v_tier text;
  v_rate numeric;
  v_distance_amount numeric;
  v_amount numeric;
  v_settlement travel_settlements;
  v_paths text[];
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;

  select * into v_summary from travel_summary_for_employee(p_emp_id);
  if v_summary.visit_count is null or v_summary.visit_count = 0 then
    raise exception 'Nothing to settle for this employee';
  end if;

  select e.ta_rate_tier into v_tier from employees e where e.id = p_emp_id;
  if v_tier is null then
    raise exception 'Set this employee''s TA rate tier (Manager/Executive) before settling';
  end if;

  select case when v_tier = 'manager' then manager_rate_per_km else executive_rate_per_km end
    into v_rate from ta_settings where id = 1;

  v_distance_amount := round(v_summary.total_km * v_rate, 2);
  v_amount := v_distance_amount + coalesce(v_summary.total_expense, 0);

  -- coalesce each side to '{}' first: `array || NULL` is NULL in Postgres, and
  -- array_agg(...) filter (...) returns NULL when no row matches (i.e. no expense
  -- photos this period) — without the coalesce, that NULL would wipe out v_paths
  -- entirely, including every ordinary selfie path, and silently skip the whole
  -- storage cleanup below.
  select coalesce(array_agg(v.photo_path), '{}'::text[])
      || coalesce(array_agg(v.expense_photo_path) filter (where v.expense_photo_path is not null), '{}'::text[])
    into v_paths from travel_visits v where v.emp_id = p_emp_id;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, expense_amount, approved_by_admin, paid_at)
    values (p_emp_id, v_summary.first_date, v_summary.last_date, v_summary.total_km, v_tier, v_rate, v_amount, coalesce(v_summary.total_expense, 0), 'admin', now())
    returning * into v_settlement;

  delete from storage.objects where bucket_id = 'travel-selfies' and name = any(v_paths);

  delete from travel_visits where emp_id = p_emp_id;

  perform log_audit('TRAVEL_SETTLED', (select name from employees where id = p_emp_id) || ' — ' || v_summary.total_km || 'km + ₹' || coalesce(v_summary.total_expense, 0) || ' expenses = ₹' || v_amount, 'admin');

  return query select v_settlement, v_paths;
end;
$function$;
