-- plan.md §52 — the same visit / expense must never be saved twice.
--
-- Found 2026-10-23: a double tap on Save Visit (the button only locked AFTER the GPS wait) sent two
-- saves within milliseconds. The server had no "already exists" check, and each save looked up "the
-- last visit" before the other was written, so both measured from the same earlier point and both
-- got the full distance (Puneet Sharma, 5 Oct: 36.87 km paid twice).
--
-- Additive: two nullable ticket columns + unique indexes. Both save functions gain an optional,
-- defaulted p_client_ticket; a new parameter changes the signature, so each old version is dropped
-- and recreated (as 0046/0067 did) — otherwise two versions would exist and a call would be
-- ambiguous. Older app screens that send no ticket keep working.

alter table public.travel_visits add column if not exists client_ticket uuid;
create unique index if not exists uq_travel_visits_ticket on public.travel_visits(emp_id, client_ticket) where client_ticket is not null;

alter table public.travel_expenses add column if not exists client_ticket uuid;
create unique index if not exists uq_travel_expenses_ticket on public.travel_expenses(emp_id, client_ticket) where client_ticket is not null;

-- ============ 1. Visits ============

drop function if exists public.employee_add_travel_visit(uuid, uuid, date, numeric, numeric, numeric, text, text, text, numeric, text);

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
  v_work_mode text;
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

grant execute on function public.employee_add_travel_visit(uuid, uuid, date, numeric, numeric, numeric, text, text, text, numeric, text, uuid) to anon;

-- ============ 2. Standalone expenses ============
-- No guessing rule (a genuine second expense, even the same amount, is always allowed): only the
-- exact same tap can never be saved twice.

drop function if exists public.employee_add_travel_expense(uuid, uuid, text, numeric, text, numeric, numeric, numeric, text);

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
  v_work text;
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

  select work_mode into v_work from employees where id = p_emp_id;
  if v_work is null or v_work not in ('field', 'both') then
    raise exception 'Travel expenses are only available for Field / Office+Field staff';
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

grant execute on function public.employee_add_travel_expense(uuid, uuid, text, numeric, text, numeric, numeric, numeric, text, uuid) to anon;
