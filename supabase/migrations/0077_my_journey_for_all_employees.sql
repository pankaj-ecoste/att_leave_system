-- plan.md §63 — My Journey for ALL employees (HR request 2026-11-14).
-- Five functions used to refuse anyone whose work_mode is not field / both. Each body below is the LATEST repo version
-- (proved identical to the live one by the apply script) with only the work-mode check removed:
--   * employee_add_travel_visit, employee_add_travel_expense — anyone may log (selfie / GPS / punched-in rules unchanged)
--   * employee_submit_travel_claim — anyone may claim, but ONLY once HR has set their rate tier (existing message kept)
--   * manager_get_team_travel_summary, admin_get_travel_overview — still list every field / both person, PLUS anyone
--     who has visits or expenses (so the screens do not fill with empty rows)
-- Punch-time field note and the Field Staff dashboard tile are NOT touched (they follow work_mode).

create or replace function public.employee_add_travel_visit(
  p_token uuid, p_emp_id uuid, p_date date, p_lat numeric, p_lon numeric,
  p_accuracy_m numeric, p_site_note text, p_photo_path text,
  p_expense_note text default null, p_expense_amount numeric default null, p_expense_photo_path text default null,
  p_client_ticket uuid default null
)
 returns travel_visits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_in_lat numeric; v_in_lon numeric; v_has_punched_in boolean; v_still_in boolean;
  v_prev_lat numeric; v_prev_lon numeric;
  v_leg_km numeric;
  v_has_expense boolean;
  v_row travel_visits;
  v_drop text[];
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  -- One of this person's saves at a time: a second save waits here until the first is committed, so
  -- it can see the first and never measures from the same earlier point.
  perform pg_advisory_xact_lock(hashtextextended('travel_visit:' || p_emp_id::text, 0));

  -- Same ticket = same tap: hand back the visit that tap already created.
  if p_client_ticket is not null then
    select * into v_row from travel_visits where emp_id = p_emp_id and client_ticket = p_client_ticket;
    if v_row.id is not null then return v_row; end if;
  end if;

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

  select in_lat, in_lon, (in_time is not null), (out_time is null)
    into v_in_lat, v_in_lon, v_has_punched_in, v_still_in
    from attendance where emp_id = p_emp_id and date = p_date;

  if not coalesce(v_has_punched_in, false) then
    raise exception 'Punch in before logging a site visit';
  end if;
  if not coalesce(v_still_in, false) then
    raise exception 'Already punched out for this date';
  end if;

  -- Safety net for older screens that send no ticket: the SAME site name, within 200 m, saved less
  -- than 10 minutes ago, is the same visit. (Checked against real data: none of the 300 genuine
  -- visits looked like this; every duplicate found did.) The attempt's own uploaded photos are
  -- removed, but only files no saved row points at.
  select * into v_row from travel_visits v
    where v.emp_id = p_emp_id and v.date = p_date
      and lower(btrim(v.site_note)) = lower(btrim(p_site_note))
      and v.captured_at > now() - interval '10 minutes'
      and haversine_m(v.lat, v.lon, p_lat, p_lon) <= 200
    order by v.captured_at desc limit 1;
  if v_row.id is not null then
    select array_agg(f) into v_drop
      from unnest(array[p_photo_path, p_expense_photo_path]) f
      where f is not null and travel_photo_is_orphaned(f);
    if v_drop is not null then perform storage_delete_objects_core('travel-selfies', v_drop); end if;
    return v_row;
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
    expense_note, expense_amount, expense_photo_path, client_ticket
  )
    values (
      p_emp_id, p_date, p_lat, p_lon, p_accuracy_m, btrim(p_site_note), p_photo_path, v_leg_km,
      nullif(btrim(coalesce(p_expense_note, '')), ''), p_expense_amount, p_expense_photo_path, p_client_ticket
    )
    returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.employee_add_travel_expense(
  p_token uuid, p_emp_id uuid, p_category text, p_amount numeric, p_photo_path text,
  p_lat numeric default null, p_lon numeric default null, p_accuracy_m numeric default null,
  p_description text default null,
  p_client_ticket uuid default null
)
 returns travel_expenses
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_in boolean; v_still_in boolean;
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_row travel_expenses;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  perform pg_advisory_xact_lock(hashtextextended('travel_expense:' || p_emp_id::text, 0));
  if p_client_ticket is not null then
    select * into v_row from travel_expenses where emp_id = p_emp_id and client_ticket = p_client_ticket;
    if v_row.id is not null then return v_row; end if;
  end if;

  if p_category is null or p_category not in ('Toll', 'Lunch', 'Other') then
    raise exception 'Choose an expense type: Toll, Lunch or Other';
  end if;
  if p_category = 'Other' and v_desc is null then
    raise exception 'Please write what this expense was for';
  end if;
  if v_desc is not null and char_length(v_desc) > 100 then
    raise exception 'The description is too long (100 characters at most)';
  end if;
  if p_category <> 'Other' then v_desc := null; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid expense amount'; end if;
  if p_amount > 100000 then raise exception 'That amount looks too large — please check it'; end if;
  if p_photo_path is null or btrim(p_photo_path) = '' then raise exception 'A bill photo is required'; end if;

  select (in_time is not null), (out_time is null) into v_in, v_still_in
    from attendance where emp_id = p_emp_id and date = v_today;
  if not coalesce(v_in, false) then
    raise exception 'Punch in before adding an expense';
  end if;
  if not coalesce(v_still_in, false) then
    raise exception 'You have already punched out — expenses can only be added between punch in and punch out';
  end if;

  insert into travel_expenses (emp_id, date, category, description, amount, photo_path, lat, lon, accuracy_m, client_ticket)
    values (p_emp_id, v_today, p_category, v_desc, p_amount, p_photo_path, p_lat, p_lon, p_accuracy_m, p_client_ticket)
    returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.employee_submit_travel_claim(p_token uuid, p_emp_id uuid, p_end date)
 returns travel_claims
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tier text;
  v_rate numeric;
  v_t record;
  v_claim travel_claims;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  select ta_rate_tier into v_tier from employees where id = p_emp_id;
  if v_tier is null then
    raise exception 'Your travel rate tier is not set yet — please ask HR or admin';
  end if;
  if p_end is null or p_end > v_today then
    raise exception 'End date cannot be in the future';
  end if;

  select * into v_t from travel_claim_totals(p_emp_id, p_end);
  if v_t.visit_count = 0 or v_t.first_date is null then
    raise exception 'No unclaimed visits up to that date';
  end if;
  if p_end - v_t.first_date + 1 < 5 then
    raise exception 'A claim must cover at least 5 days (from % to %)', v_t.first_date, p_end;
  end if;

  select case when v_tier = 'manager' then manager_rate_per_km else executive_rate_per_km end
    into v_rate from ta_settings where id = 1;

  insert into travel_claims (emp_id, period_start, period_end, status, total_km, distance_amount, expense_amount, amount, rate_tier, rate_per_km)
  values (
    p_emp_id, v_t.first_date, p_end, 'Submitted', v_t.total_km,
    round(v_t.total_km * v_rate, 2), coalesce(v_t.total_expense, 0),
    round(v_t.total_km * v_rate, 2) + coalesce(v_t.total_expense, 0),
    v_tier, v_rate
  )
  returning * into v_claim;

  update travel_visits set claim_id = v_claim.id
    where emp_id = p_emp_id and claim_id is null and date <= p_end;
  update travel_expenses set claim_id = v_claim.id
    where emp_id = p_emp_id and claim_id is null and date <= p_end;

  perform log_audit('TRAVEL_CLAIM_SUBMITTED',
    (select name from employees where id = p_emp_id) || ' — ' || v_claim.period_start || ' to ' || v_claim.period_end || ', ₹' || v_claim.amount,
    'employee');

  return v_claim;
end;
$function$;

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
    where e.manager_emp_id = p_manager_id
      and (e.work_mode in ('field', 'both') or coalesce(s.visit_count, 0) > 0 or coalesce(s.total_expense, 0) > 0)
      and e.deleted_at is null and e.active
    order by e.name;
end;
$function$;

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
    where (e.work_mode in ('field', 'both') or coalesce(s.visit_count, 0) > 0 or coalesce(s.total_expense, 0) > 0)
      and e.deleted_at is null and e.active
    order by e.name;
end;
$function$;

-- (create or replace keeps each function's existing permissions — no grant lines on purpose.)
