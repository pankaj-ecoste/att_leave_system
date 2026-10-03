-- plan.md §46 — travel claims: staff submit a dated claim, admin marks it Paid.
--
-- Additive only. Existing functions are not redefined. The old admin_settle_travel_period
-- stays in the database but the UI no longer calls it (removal is a later clean-up).

-- ============ 1. travel_claims ============

create table if not exists public.travel_claims (
  id uuid default gen_random_uuid() not null primary key,
  emp_id uuid not null references employees(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'Submitted' check (status in ('Submitted', 'Paid')),
  total_km numeric not null,
  distance_amount numeric not null,
  expense_amount numeric not null default 0,
  amount numeric not null,
  rate_tier text not null,
  rate_per_km numeric not null,
  submitted_at timestamp with time zone default now() not null,
  paid_at timestamp with time zone
);

create index if not exists idx_travel_claims_emp on public.travel_claims(emp_id);
alter table travel_claims enable row level security;
-- No anon grants on the table: all access goes through the token-checked functions below.
revoke all on table public.travel_claims from anon, authenticated;

-- Which claim (if any) a visit belongs to. Null = not claimed yet.
alter table travel_visits add column if not exists claim_id uuid references travel_claims(id) on delete set null;
create index if not exists idx_travel_visits_claim on public.travel_visits(claim_id);

-- ============ 2. Totals for unclaimed visits up to an end date (internal) ============
-- Same leg logic as travel_summary_for_employee, restricted to unclaimed visits dated on or
-- before p_end. Not anon-granted — called only from the token-checked submit function below.

create or replace function public.travel_claim_totals(p_emp_id uuid, p_end date)
 returns table(total_km numeric, total_expense numeric, first_date date, visit_count integer)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with v as (
    select * from travel_visits where emp_id = p_emp_id and claim_id is null and date <= p_end
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
    coalesce((select sum(expense_amount) from v), 0),
    (select min(date) from v),
    (select count(*)::int from v);
$function$;

revoke execute on function public.travel_claim_totals(uuid, date) from public, anon, authenticated;

-- ============ 3. Staff — submit a claim ============

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

  perform log_audit('TRAVEL_CLAIM_SUBMITTED',
    (select name from employees where id = p_emp_id) || ' — ' || v_claim.period_start || ' to ' || v_claim.period_end || ', ₹' || v_claim.amount,
    'employee');

  return v_claim;
end;
$function$;

grant execute on function public.employee_submit_travel_claim(uuid, uuid, date) to anon;

-- ============ 4. Admin — mark Paid: pay record kept, visits removed (archive trigger keeps analytics) ============

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

  select coalesce(array_agg(photo_path), '{}'::text[])
      || coalesce(array_agg(expense_photo_path) filter (where expense_photo_path is not null), '{}'::text[])
    into v_paths from travel_visits where claim_id = p_claim_id;

  update travel_claims set status = 'Paid', paid_at = now() where id = p_claim_id returning * into v_c;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, expense_amount, approved_by_admin, paid_at)
  values (v_c.emp_id, v_c.period_start, v_c.period_end, v_c.total_km, v_c.rate_tier, v_c.rate_per_km, v_c.amount, v_c.expense_amount, 'admin', now());

  delete from travel_visits where claim_id = p_claim_id;

  perform log_audit('TRAVEL_CLAIM_PAID',
    (select name from employees where id = v_c.emp_id) || ' — ' || v_c.period_start || ' to ' || v_c.period_end || ', ₹' || v_c.amount,
    'admin');

  return query select v_c, v_paths;
end;
$function$;

grant execute on function public.admin_mark_travel_claim_paid(uuid, uuid) to anon;

-- ============ 5. Lists — only Submitted claims are shown; Paid ones leave both panels ============

create or replace function public.employee_get_travel_claims(p_token uuid, p_emp_id uuid)
 returns setof travel_claims
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from travel_claims where emp_id = p_emp_id and status = 'Submitted' order by submitted_at desc;
end;
$function$;

grant execute on function public.employee_get_travel_claims(uuid, uuid) to anon;

create or replace function public.admin_get_travel_claims(p_token uuid)
 returns setof travel_claims
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from travel_claims where status = 'Submitted' order by submitted_at;
end;
$function$;

grant execute on function public.admin_get_travel_claims(uuid) to anon;
