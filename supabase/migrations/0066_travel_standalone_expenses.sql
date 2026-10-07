-- plan.md §48 — field staff can log a toll / lunch / other expense on its own, between
-- punch-in and punch-out (the journey home had no site to attach a toll to).
--
-- New table + new functions. Existing functions are only changed where a standalone expense must
-- be counted or its receipt photo recognised (summary, claim totals, claim submit, mark paid,
-- photo access/orphan checks). Signatures and return shapes are unchanged.

-- ============ 1. travel_expenses ============

create table if not exists public.travel_expenses (
  id uuid default gen_random_uuid() not null primary key,
  emp_id uuid not null references employees(id) on delete cascade,
  date date not null,
  captured_at timestamp with time zone default now() not null,
  category text not null check (category in ('Toll', 'Lunch', 'Other')),
  amount numeric not null check (amount > 0 and amount <= 100000),
  photo_path text not null,
  -- Best effort: a weak signal on a highway must not stop someone logging a toll. The receipt is the evidence.
  lat numeric,
  lon numeric,
  accuracy_m numeric,
  claim_id uuid references travel_claims(id) on delete set null,
  created_at timestamp with time zone default now() not null
);

create index if not exists idx_travel_expenses_emp on public.travel_expenses(emp_id);
create index if not exists idx_travel_expenses_claim on public.travel_expenses(claim_id);
alter table travel_expenses enable row level security;
revoke all on table public.travel_expenses from anon, authenticated;

-- ============ 2. Staff — add an expense (only between punch-in and punch-out) ============
-- The date is the SERVER's today (IST), not a value the phone sends: no backdating.

create or replace function public.employee_add_travel_expense(
  p_token uuid, p_emp_id uuid, p_category text, p_amount numeric, p_photo_path text,
  p_lat numeric default null, p_lon numeric default null, p_accuracy_m numeric default null
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
  v_row travel_expenses;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  select work_mode into v_work from employees where id = p_emp_id;
  if v_work is null or v_work not in ('field', 'both') then
    raise exception 'Travel expenses are only available for Field / Office+Field staff';
  end if;
  if p_category is null or p_category not in ('Toll', 'Lunch', 'Other') then
    raise exception 'Choose an expense type: Toll, Lunch or Other';
  end if;
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

  insert into travel_expenses (emp_id, date, category, amount, photo_path, lat, lon, accuracy_m)
    values (p_emp_id, v_today, p_category, p_amount, p_photo_path, p_lat, p_lon, p_accuracy_m)
    returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.employee_add_travel_expense(uuid, uuid, text, numeric, text, numeric, numeric, numeric) to anon;

-- ============ 3. Staff — delete own expense until it is part of a submitted claim ============
-- Deleting is logged (who, what, how much). Editing is not offered: a wrong amount is deleted and re-entered.

create or replace function public.employee_delete_travel_expense(p_token uuid, p_emp_id uuid, p_expense_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_e travel_expenses;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  select * into v_e from travel_expenses where id = p_expense_id and emp_id = p_emp_id for update;
  if v_e.id is null then raise exception 'Expense not found'; end if;
  if v_e.claim_id is not null then raise exception 'This expense is already part of a submitted claim'; end if;

  delete from travel_expenses where id = p_expense_id;
  perform storage_delete_objects_core('travel-selfies', array[v_e.photo_path]);

  perform log_audit('TRAVEL_EXPENSE_DELETED',
    (select name from employees where id = p_emp_id) || ' — ' || v_e.category || ' ₹' || v_e.amount || ' on ' || v_e.date,
    'employee');
end;
$function$;

grant execute on function public.employee_delete_travel_expense(uuid, uuid, uuid) to anon;

-- ============ 4. Reads — staff / admin / manager ============

create or replace function public.employee_get_travel_expenses(p_token uuid, p_emp_id uuid)
 returns setof travel_expenses
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from travel_expenses where emp_id = p_emp_id order by captured_at;
end;
$function$;

create or replace function public.admin_get_employee_travel_expenses(p_token uuid, p_emp_id uuid)
 returns setof travel_expenses
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from travel_expenses where emp_id = p_emp_id order by captured_at;
end;
$function$;

create or replace function public.manager_get_team_travel_expenses(p_token uuid, p_manager_id uuid, p_emp_id uuid)
 returns setof travel_expenses
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if not exists (select 1 from employees where id = p_emp_id and manager_emp_id = p_manager_id) then
    raise exception 'Not your team member';
  end if;
  return query select * from travel_expenses where emp_id = p_emp_id order by captured_at;
end;
$function$;

grant execute on function public.employee_get_travel_expenses(uuid, uuid) to anon;
grant execute on function public.admin_get_employee_travel_expenses(uuid, uuid) to anon;
grant execute on function public.manager_get_team_travel_expenses(uuid, uuid, uuid) to anon;

-- ============ 5. Totals — count standalone expenses ============
-- Summary shown to staff / manager / admin: expense total now includes them.

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
    select coalesce(a.travel_return_road_km, haversine_m(lv.lat, lv.lon, a.out_lat, a.out_lon) / 1000.0, 0) as km
    from last_visit_per_day lv
    join attendance a on a.emp_id = p_emp_id and a.date = lv.date
    where a.out_lat is not null and a.out_lon is not null
  )
  select
    coalesce((
      select sum(case when v.distance_overridden then v.leg_distance_km else coalesce(v.road_leg_km, v.leg_distance_km) end)
      from travel_visits v where v.emp_id = p_emp_id
    ), 0) + coalesce((select sum(km) from return_legs), 0) as total_km,
    coalesce((select sum(v.expense_amount) from travel_visits v where v.emp_id = p_emp_id), 0)
      + coalesce((select sum(x.amount) from travel_expenses x where x.emp_id = p_emp_id), 0) as total_expense,
    (select count(*)::int from travel_visits v where v.emp_id = p_emp_id) as visit_count,
    (select min(v.date) from travel_visits v where v.emp_id = p_emp_id) as first_date,
    (select max(v.date) from travel_visits v where v.emp_id = p_emp_id) as last_date;
$function$;

-- Claim totals: unclaimed standalone expenses dated up to the end date are included, and an
-- expense dated before the first visit pulls the period start back so it is not left out.

create or replace function public.travel_claim_totals(p_emp_id uuid, p_end date)
 returns table(total_km numeric, total_expense numeric, first_date date, visit_count integer)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with v as (
    select * from travel_visits where emp_id = p_emp_id and claim_id is null and date <= p_end
  ), x as (
    select * from travel_expenses where emp_id = p_emp_id and claim_id is null and date <= p_end
  ), last_visit_per_day as (
    select distinct on (date) date, lat, lon from v order by date, captured_at desc
  ), return_legs as (
    select coalesce(a.travel_return_road_km, haversine_m(lv.lat, lv.lon, a.out_lat, a.out_lon) / 1000.0, 0) as km
    from last_visit_per_day lv
    join attendance a on a.emp_id = p_emp_id and a.date = lv.date
    where a.out_lat is not null and a.out_lon is not null
  )
  select
    coalesce((select sum(case when v.distance_overridden then v.leg_distance_km else coalesce(v.road_leg_km, v.leg_distance_km) end) from v), 0)
      + coalesce((select sum(km) from return_legs), 0),
    coalesce((select sum(expense_amount) from v), 0) + coalesce((select sum(amount) from x), 0),
    least((select min(date) from v), (select min(date) from x)),
    (select count(*)::int from v);
$function$;

-- ============ 6. Claim submit — also claim the standalone expenses ============

create or replace function public.employee_submit_travel_claim(p_token uuid, p_emp_id uuid, p_end date)
 returns travel_claims
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_work text;
  v_tier text;
  v_rate numeric;
  v_t record;
  v_claim travel_claims;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  select work_mode, ta_rate_tier into v_work, v_tier from employees where id = p_emp_id;
  if v_work is null or v_work not in ('field', 'both') then
    raise exception 'Travel claims are only for Field / Office+Field staff';
  end if;
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

-- ============ 7. Mark Paid — remove the claim's standalone expenses and their receipts too ============

create or replace function public.admin_mark_travel_claim_paid(p_token uuid, p_claim_id uuid)
 returns table(claim travel_claims, photo_paths text[])
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c travel_claims;
  v_paths text[];
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;

  select * into v_c from travel_claims where id = p_claim_id for update;
  if v_c.id is null then raise exception 'Claim not found'; end if;
  if v_c.status <> 'Submitted' then raise exception 'This claim is already %', v_c.status; end if;

  select coalesce((select array_agg(photo_path) from travel_visits where claim_id = p_claim_id), '{}'::text[])
      || coalesce((select array_agg(expense_photo_path) from travel_visits where claim_id = p_claim_id and expense_photo_path is not null), '{}'::text[])
      || coalesce((select array_agg(photo_path) from travel_expenses where claim_id = p_claim_id), '{}'::text[])
    into v_paths;

  update travel_claims set status = 'Paid', paid_at = now() where id = p_claim_id returning * into v_c;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, expense_amount, approved_by_admin, paid_at)
  values (v_c.emp_id, v_c.period_start, v_c.period_end, v_c.total_km, v_c.rate_tier, v_c.rate_per_km, v_c.amount, v_c.expense_amount, 'admin', now());

  delete from travel_visits where claim_id = p_claim_id;
  delete from travel_expenses where claim_id = p_claim_id;

  -- Photos removed server-side; the payment above is already committed either way.
  perform storage_delete_objects_core('travel-selfies', v_paths);

  perform log_audit('TRAVEL_CLAIM_PAID',
    (select name from employees where id = v_c.emp_id) || ' — ' || v_c.period_start || ' to ' || v_c.period_end || ', ₹' || v_c.amount,
    'admin');

  return query select v_c, v_paths;
end;
$function$;

-- ============ 8. Receipt photo access / orphan check — recognise expense receipts ============

create or replace function public.employee_get_own_travel_photo_url(p_token uuid, p_emp_id uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  if not exists (
    select 1 from travel_visits where emp_id = p_emp_id and (photo_path = p_path or expense_photo_path = p_path)
  ) and not exists (
    select 1 from travel_expenses where emp_id = p_emp_id and photo_path = p_path
  ) then
    raise exception 'Not your photo';
  end if;
  return storage_sign_url_core('travel-selfies', p_path, 300);
end;
$function$;

create or replace function public.manager_get_team_travel_photo_url(p_token uuid, p_manager_id uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if not exists (
    select 1 from travel_visits v join employees e on e.id = v.emp_id
    where (v.photo_path = p_path or v.expense_photo_path = p_path) and e.manager_emp_id = p_manager_id
  ) and not exists (
    select 1 from travel_expenses x join employees e on e.id = x.emp_id
    where x.photo_path = p_path and e.manager_emp_id = p_manager_id
  ) then
    raise exception 'Not your team member''s photo';
  end if;
  return storage_sign_url_core('travel-selfies', p_path, 300);
end;
$function$;

create or replace function public.admin_get_travel_photo_url(p_token uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  if not exists (
    select 1 from travel_visits where photo_path = p_path or expense_photo_path = p_path
  ) and not exists (
    select 1 from travel_expenses where photo_path = p_path
  ) then
    raise exception 'No such photo';
  end if;
  return storage_sign_url_core('travel-selfies', p_path, 300);
end;
$function$;

create or replace function public.travel_photo_is_orphaned(p_path text)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1 from travel_visits v where v.photo_path = p_path or v.expense_photo_path = p_path
  ) and not exists (
    select 1 from travel_expenses x where x.photo_path = p_path
  );
$function$;
