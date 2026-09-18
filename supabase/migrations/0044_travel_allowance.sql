-- plan.md §28 — Travel Allowance (TA) verification: client-visit journey tracking.
--
-- PRODUCTION SAFETY: this migration is purely additive. It creates new tables, a new
-- storage bucket, and new functions only. It does not ALTER, DROP, or CREATE OR REPLACE
-- any function that already exists (employee_punch, admin_update_employee,
-- fetch_directory, etc. are untouched) — explicit instruction for this feature, the app
-- is live with real production data.

-- ============ 1. employees.ta_rate_tier — new nullable column ============
-- Deliberately NOT reusing `designation` (messy imported bio-device text like "Sr.
-- Executive") — a clean field admin sets explicitly, same reasoning as the existing
-- std_hours_override column (0036, plan.md §16). Adding a nullable column to an
-- existing table is non-breaking: no existing function selects it, so nothing that
-- currently runs changes behaviour.

alter table employees add column if not exists ta_rate_tier text;
alter table employees drop constraint if exists employees_ta_rate_tier_check;
alter table employees add constraint employees_ta_rate_tier_check
  check (ta_rate_tier is null or ta_rate_tier in ('manager', 'executive'));

-- ============ 2. ta_settings — singleton, admin-editable ₹/km rates ============
-- Same singleton-row shape as monthly_sheet_cache (id smallint, check id=1). A new
-- table rather than adding columns to app_settings, so the existing app_settings
-- read/write functions (admin_update_settings, app_settings_public) never need to
-- change shape.

create table if not exists public.ta_settings (
  "id" smallint not null primary key check (id = 1),
  "manager_rate_per_km" numeric not null default 0,
  "executive_rate_per_km" numeric not null default 0,
  "updated_at" timestamp with time zone default now() not null
);

insert into public.ta_settings (id, manager_rate_per_km, executive_rate_per_km)
values (1, 0, 0)
on conflict (id) do nothing;

alter table ta_settings enable row level security;

-- ============ 3. travel_visits — one row per selfie/site visit ============
-- Deliberately no "settlement_id" / status column: whatever rows currently exist for an
-- employee ARE the open, unsettled period — admin_settle_travel_period (below) deletes
-- them the moment they're paid, so "still present" already means "not yet settled".

create table if not exists public.travel_visits (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "date" date not null,
  "captured_at" timestamp with time zone default now() not null,
  "lat" numeric(9,6) not null,
  "lon" numeric(9,6) not null,
  "accuracy_m" numeric,
  "site_note" text not null,
  "photo_path" text not null,
  "leg_distance_km" numeric not null default 0,
  "distance_overridden" boolean not null default false,
  "override_reason" text,
  "created_at" timestamp with time zone default now() not null
);

create index if not exists idx_travel_visits_emp_date on public.travel_visits(emp_id, date);

alter table travel_visits enable row level security;

-- ============ 4. travel_settlements — lightweight summary kept after payment ============
-- plan.md §28 decision 8: heavy data (photos, individual points) is deleted once paid,
-- but this one small row per settlement survives as the audit trail.

create table if not exists public.travel_settlements (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "period_start" date not null,
  "period_end" date not null,
  "total_km" numeric not null,
  "rate_tier" text not null,
  "rate_per_km" numeric not null,
  "amount" numeric not null,
  "approved_by_admin" text not null default 'admin',
  "paid_at" timestamp with time zone default now() not null
);

create index if not exists idx_travel_settlements_emp on public.travel_settlements(emp_id);

alter table travel_settlements enable row level security;

-- No anon grants on any of the three tables above — same posture as leave_applications/
-- location_logs (0002_hrms_schema.sql): RLS is on, there is no anon policy, so the only
-- way in is through the SECURITY DEFINER functions below, each of which runs as the
-- function owner (bypasses RLS) after its own explicit token check.

-- ============ 5. Storage bucket — camera-only selfies ============
-- Same private-bucket pattern as leave-documents (0019_earned_leave_advance_notice.sql):
-- unguessable client-generated path, private (no public URL), reads via a short-lived
-- signed URL. A delete policy is added here (leave-documents never needed one) because
-- settlement cleanup removes files once a period is paid.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('travel-selfies', 'travel-selfies', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anon can upload travel selfies" on storage.objects;
create policy "anon can upload travel selfies" on storage.objects for insert to anon
  with check (bucket_id = 'travel-selfies');

drop policy if exists "anon can read travel selfies" on storage.objects;
create policy "anon can read travel selfies" on storage.objects for select to anon
  using (bucket_id = 'travel-selfies');

drop policy if exists "anon can delete travel selfies" on storage.objects;
create policy "anon can delete travel selfies" on storage.objects for delete to anon
  using (bucket_id = 'travel-selfies');

-- ============ 6. travel_summary_for_employee — shared aggregate helper ============
-- Distance = sum of every stored leg (punch-in/prev-visit -> this visit) PLUS, for any
-- day that already has a punch-out with coordinates, the implicit final leg from that
-- day's last visit back to the punch-out point — computed here, never stored, so it
-- updates itself the moment the employee punches out without touching employee_punch.
-- Not anon-granted: only called from inside the token-checked functions below.

create or replace function public.travel_summary_for_employee(p_emp_id uuid)
 returns table(total_km numeric, visit_count integer, first_date date, last_date date)
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
    (select count(*)::int from travel_visits v where v.emp_id = p_emp_id) as visit_count,
    (select min(v.date) from travel_visits v where v.emp_id = p_emp_id) as first_date,
    (select max(v.date) from travel_visits v where v.emp_id = p_emp_id) as last_date;
$function$;

-- ============ 7. Employee — log a visit, view own journey/summary/settlements ============

create or replace function public.employee_add_travel_visit(
  p_token uuid, p_emp_id uuid, p_date date, p_lat numeric, p_lon numeric,
  p_accuracy_m numeric, p_site_note text, p_photo_path text
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
  v_row travel_visits;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  if p_site_note is null or btrim(p_site_note) = '' then raise exception 'Site/client name is required'; end if;
  if p_photo_path is null or btrim(p_photo_path) = '' then raise exception 'Selfie photo is required'; end if;

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

  insert into travel_visits (emp_id, date, lat, lon, accuracy_m, site_note, photo_path, leg_distance_km)
    values (p_emp_id, p_date, p_lat, p_lon, p_accuracy_m, btrim(p_site_note), p_photo_path, v_leg_km)
    returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.employee_get_travel_journey(p_token uuid, p_emp_id uuid)
 returns setof travel_visits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from travel_visits where emp_id = p_emp_id order by captured_at;
end;
$function$;

create or replace function public.employee_get_travel_summary(p_token uuid, p_emp_id uuid)
 returns table(total_km numeric, visit_count integer, first_date date, last_date date)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from travel_summary_for_employee(p_emp_id);
end;
$function$;

create or replace function public.employee_get_travel_settlements(p_token uuid, p_emp_id uuid)
 returns setof travel_settlements
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from travel_settlements where emp_id = p_emp_id order by paid_at desc;
end;
$function$;

-- ============ 8. Manager — read-only team journey view (mirrors manager_get_team_location_logs) ============

create or replace function public.manager_get_team_travel_summary(p_token uuid, p_manager_id uuid)
 returns table(emp_id uuid, emp_name text, emp_num text, ta_rate_tier text, total_km numeric, visit_count integer, first_date date, last_date date)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select e.id, e.name, e.emp_num, e.ta_rate_tier, s.total_km, s.visit_count, s.first_date, s.last_date
    from employees e
    cross join lateral travel_summary_for_employee(e.id) s
    where e.manager_emp_id = p_manager_id and e.work_mode in ('field', 'both')
      and e.deleted_at is null and e.active
    order by e.name;
end;
$function$;

create or replace function public.manager_get_team_travel_journey(p_token uuid, p_manager_id uuid, p_emp_id uuid)
 returns setof travel_visits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if not exists (select 1 from employees where id = p_emp_id and manager_emp_id = p_manager_id) then
    raise exception 'Not your team member';
  end if;
  return query select * from travel_visits where emp_id = p_emp_id order by captured_at;
end;
$function$;

-- ============ 9. Admin — overview, rate tiers, rates, overrides, settlement ============

create or replace function public.admin_get_travel_overview(p_token uuid)
 returns table(emp_id uuid, emp_name text, emp_num text, work_mode text, ta_rate_tier text, total_km numeric, visit_count integer, first_date date, last_date date)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select e.id, e.name, e.emp_num, e.work_mode, e.ta_rate_tier, s.total_km, s.visit_count, s.first_date, s.last_date
    from employees e
    cross join lateral travel_summary_for_employee(e.id) s
    where e.work_mode in ('field', 'both') and e.deleted_at is null and e.active
    order by e.name;
end;
$function$;

create or replace function public.admin_get_employee_travel_journey(p_token uuid, p_emp_id uuid)
 returns setof travel_visits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from travel_visits where emp_id = p_emp_id order by captured_at;
end;
$function$;

create or replace function public.admin_get_travel_settlements(p_token uuid, p_emp_id uuid)
 returns setof travel_settlements
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from travel_settlements where emp_id = p_emp_id order by paid_at desc;
end;
$function$;

create or replace function public.admin_set_ta_rate_tier(p_token uuid, p_emp_id uuid, p_tier text)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  if p_tier is not null and p_tier not in ('manager', 'executive') then
    raise exception 'Invalid TA rate tier: %', p_tier;
  end if;
  update employees set ta_rate_tier = p_tier, updated_at = now() where id = p_emp_id returning * into v_row;
  perform log_audit('TA_RATE_TIER_SET', v_row.name || ' -> ' || coalesce(p_tier, 'none'), 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_get_ta_settings(p_token uuid)
 returns ta_settings
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row ta_settings;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  select * into v_row from ta_settings where id = 1;
  return v_row;
end;
$function$;

create or replace function public.admin_update_ta_settings(p_token uuid, p_manager_rate numeric, p_executive_rate numeric)
 returns ta_settings
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row ta_settings;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update ta_settings set
    manager_rate_per_km = coalesce(p_manager_rate, manager_rate_per_km),
    executive_rate_per_km = coalesce(p_executive_rate, executive_rate_per_km),
    updated_at = now()
    where id = 1 returning * into v_row;
  perform log_audit('TA_RATES_UPDATED', 'Manager ₹' || v_row.manager_rate_per_km || '/km, Executive ₹' || v_row.executive_rate_per_km || '/km', 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_override_travel_visit_distance(p_token uuid, p_visit_id uuid, p_new_km numeric, p_reason text)
 returns travel_visits
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row travel_visits;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A reason is required to override a visit distance'; end if;
  if p_new_km is null or p_new_km < 0 then raise exception 'Distance must be a positive number'; end if;
  update travel_visits set leg_distance_km = p_new_km, distance_overridden = true, override_reason = btrim(p_reason)
    where id = p_visit_id returning * into v_row;
  if v_row.id is null then raise exception 'Visit not found'; end if;
  perform log_audit('TRAVEL_DISTANCE_OVERRIDE', v_row.emp_id::text || ' visit ' || v_row.id::text || ' -> ' || p_new_km || 'km: ' || p_reason, 'admin');
  return v_row;
end;
$function$;

-- Settles the employee's entire currently-open period (everything sitting in
-- travel_visits for them right now — see the comment on travel_visits above for why
-- there's no separate "period" concept). Deletes the visit rows and returns the photo
-- paths so the caller can remove the storage files as a second step — done in this
-- order (DB settlement first) so the permanent audit row and the delete are never lost
-- even if the storage cleanup step fails; a leftover orphaned photo file is a harmless,
-- cheap cleanup later, unlike losing the paid-amount record.
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

  v_amount := round(v_summary.total_km * v_rate, 2);

  select array_agg(v.photo_path) into v_paths from travel_visits v where v.emp_id = p_emp_id;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, approved_by_admin, paid_at)
    values (p_emp_id, v_summary.first_date, v_summary.last_date, v_summary.total_km, v_tier, v_rate, v_amount, 'admin', now())
    returning * into v_settlement;

  delete from travel_visits where emp_id = p_emp_id;

  perform log_audit('TRAVEL_SETTLED', (select name from employees where id = p_emp_id) || ' — ' || v_summary.total_km || 'km, ₹' || v_amount, 'admin');

  return query select v_settlement, v_paths;
end;
$function$;

-- ============ 10. Grants — anon-executable, same posture as every other RPC in the app ============
-- (custom PIN auth, not Supabase auth — every function above does its own token check
-- as its first line; this mirrors e.g. 0007_geofence_and_wfh.sql's grants section)

grant execute on function public.employee_add_travel_visit(uuid, uuid, date, numeric, numeric, numeric, text, text) to anon;
grant execute on function public.employee_get_travel_journey(uuid, uuid) to anon;
grant execute on function public.employee_get_travel_summary(uuid, uuid) to anon;
grant execute on function public.employee_get_travel_settlements(uuid, uuid) to anon;
grant execute on function public.manager_get_team_travel_summary(uuid, uuid) to anon;
grant execute on function public.manager_get_team_travel_journey(uuid, uuid, uuid) to anon;
grant execute on function public.admin_get_travel_overview(uuid) to anon;
grant execute on function public.admin_get_employee_travel_journey(uuid, uuid) to anon;
grant execute on function public.admin_get_travel_settlements(uuid, uuid) to anon;
grant execute on function public.admin_set_ta_rate_tier(uuid, uuid, text) to anon;
grant execute on function public.admin_get_ta_settings(uuid) to anon;
grant execute on function public.admin_update_ta_settings(uuid, numeric, numeric) to anon;
grant execute on function public.admin_override_travel_visit_distance(uuid, uuid, numeric, text) to anon;
grant execute on function public.admin_settle_travel_period(uuid, uuid) to anon;
