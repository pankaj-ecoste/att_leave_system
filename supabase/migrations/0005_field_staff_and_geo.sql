-- Day 2 midday — field staff & quality (plan.md Phase 3, PROGRESS.md P3-5..P3-9).
-- P3-1..P3-4 (the `sites` table, server geofence, punch tiles, radius rejection) stay
-- out of this file — blocked on Q-1 (office coordinates), not yet supplied.
-- P3-10..P3-13 (separating app vs biometric punches into distinct columns) is a
-- larger schema change deliberately left for its own follow-up migration.

-- ============ EMPLOYEE WORK MODE (P3-5) ============
-- Office / Field / Both. Field and Both employees write a structured note instead of
-- passing the office geofence check once that lands (Decision 4, plan.md §6).

alter table employees add column if not exists work_mode text not null default 'office'
  check (work_mode in ('office', 'field', 'both'));

-- ============ FIELD NOTE (P3-6) ============
-- A dedicated column, not `remark` — `remark` is written by the biometric imports
-- (see useDailyBioImport.js) and would silently overwrite/be overwritten by it. This
-- keeps the two apart until the real app/bio split (P3-10) lands.

alter table attendance add column if not exists field_note text;

-- ============ SERVER-SIDE REVERSE GEOCODING (P3-9) ============
-- Moves reverse geocoding off the browser (plan.md §4.4 #8 — calling Nominatim
-- directly from every punch is against their usage policy and leaks staff locations
-- to a third party on every request) and caches by a ~11m grid so repeat punches from
-- the same handful of real-world locations don't re-hit Nominatim at all.

create extension if not exists "http" with schema "extensions";

create table if not exists "public"."geocode_cache" (
  "lat_key" numeric(8,4) not null,
  "lon_key" numeric(8,4) not null,
  "label" text,
  "cached_at" timestamp with time zone default now() not null,
  primary key (lat_key, lon_key)
);

create or replace function public.reverse_geocode(p_lat numeric, p_lon numeric)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_lat_key numeric(8,4) := round(p_lat, 4);
  v_lon_key numeric(8,4) := round(p_lon, 4);
  v_label text;
  v_resp extensions.http_response;
  v_url text;
begin
  select label into v_label from geocode_cache where lat_key = v_lat_key and lon_key = v_lon_key;
  if v_label is not null then
    return v_label;
  end if;

  v_url := format(
    'https://nominatim.openstreetmap.org/reverse?format=json&lat=%s&lon=%s&zoom=16&addressdetails=1',
    p_lat, p_lon
  );

  begin
    select * into v_resp from extensions.http((
      'GET', v_url,
      array[extensions.http_header('User-Agent', 'EcosteHRMS/1.0 (support16@ecoste.in)')],
      null, null
    )::extensions.http_request);
  exception when others then
    -- A geocoded label is a convenience, never the reason a punch fails.
    return null;
  end;

  if v_resp.status is distinct from 200 then
    return null;
  end if;

  v_label := v_resp.content::jsonb ->> 'display_name';
  if v_label is not null then
    insert into geocode_cache (lat_key, lon_key, label) values (v_lat_key, v_lon_key, v_label)
      on conflict (lat_key, lon_key) do update set label = excluded.label, cached_at = now();
  end if;

  return v_label;
end;
$function$;

grant execute on function public.reverse_geocode(numeric, numeric) to anon;

-- ============ fetch_directory — add work_mode (currentUser comes from here) ============
-- Postgres refuses `create or replace` when a function's RETURNS TABLE column list
-- changes ("cannot change return type of existing function") — has to be dropped first.

drop function if exists public.fetch_directory();

create or replace function public.fetch_directory()
 returns table(id uuid, name text, company text, emp_num text, job_title text, bu text, dept text, sub_dept text, location_info text, cost_center text, manager text, email text, phone text, joining_date date, active boolean, shift_type text, manager_emp_id uuid, work_mode text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query select e.id, e.name, e.company, e.emp_num, e.job_title,
    e.business_unit, e.department, e.sub_department, e.location_info, e.cost_center,
    e.manager, e.email, e.phone, e.joining_date, e.active,
    e.shift_type, e.manager_emp_id, e.work_mode
  from employees e where e.active = true order by e.name;
end;$function$;

-- ============ admin_create_employee / admin_update_employee — add work_mode ============

create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_row employees; v_joining_date date;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_joining_date := nullif(p_data->>'joiningDate', '')::date;
  -- New hires default to Probation (table default) with a 3-month probation window
  -- from their joining date, per plan.md Phase 2 / policy §6A — admin can extend to
  -- 6 months later via admin_set_employment_status.
  insert into employees(name, pin, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, email, phone, joining_date, shift_type, manager_emp_id,
    probation_end_date, work_mode)
  values(
    p_data->>'name', crypt(coalesce(nullif(p_data->>'pin', ''), substr(md5(random()::text), 1, 4)), gen_salt('bf')),
    p_data->>'company',
    p_data->>'empNum', p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone',
    v_joining_date,
    coalesce(nullif(p_data->>'shiftType', ''), 'none'),
    nullif(p_data->>'managerEmpId', '')::uuid,
    case when v_joining_date is not null then (v_joining_date + interval '3 months')::date else null end,
    coalesce(nullif(p_data->>'workMode', ''), 'office')
  ) returning * into v_row;
  perform log_audit('EMPLOYEE_CREATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;$function$;

create or replace function public.admin_update_employee(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update employees set
    name=coalesce(p_data->>'name', name),
    pin=case when nullif(p_data->>'pin', '') is not null then crypt(p_data->>'pin', gen_salt('bf')) else pin end,
    company=coalesce(p_data->>'company', company),
    emp_num=coalesce(p_data->>'empNum', emp_num),
    job_title=coalesce(p_data->>'jobTitle', job_title),
    business_unit=coalesce(p_data->>'bu', business_unit),
    department=coalesce(p_data->>'dept', department),
    sub_department=coalesce(p_data->>'subDept', sub_department),
    location_info=coalesce(p_data->>'locationInfo', location_info),
    cost_center=coalesce(p_data->>'costCenter', cost_center),
    manager=coalesce(p_data->>'manager', manager),
    email=coalesce(p_data->>'email', email),
    phone=coalesce(p_data->>'phone', phone),
    joining_date=coalesce(nullif(p_data->>'joiningDate', '')::date, joining_date),
    shift_type=coalesce(nullif(p_data->>'shiftType', ''), shift_type),
    work_mode=coalesce(nullif(p_data->>'workMode', ''), work_mode),
    manager_emp_id=case
      when p_data ? 'managerEmpId' then nullif(p_data->>'managerEmpId', '')::uuid
      else manager_emp_id
    end,
    updated_at=now()
  where id=p_emp_id returning * into v_row;
  perform log_audit('EMPLOYEE_UPDATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;$function$;

-- ============ employee_punch — field_note + duplicate-tap cooldown (P3-6, P3-8) ============

create or replace function public.employee_punch(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row attendance;
  v_existing attendance;
  v_punch_type text := p_data->>'punch_type';
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  select * into v_existing from attendance where emp_id = p_emp_id and date = (p_data->>'date')::date;

  -- Duplicate-tap guard (P3-8): the client already disables the button while a punch
  -- is in flight, but the server is the one that decides (plan.md §8C) — this is the
  -- backstop if two calls land anyway. 30s mirrors PUNCH_COOLDOWN_MS in lib/constants.js.
  if v_existing.id is not null and v_punch_type is not null
     and v_existing.updated_at > now() - interval '30 seconds' then
    if v_punch_type = 'in' and v_existing.in_time is not distinct from nullif(p_data->>'in_time', '')::time then
      raise exception 'Duplicate punch ignored — please wait a few seconds and try again';
    end if;
    if v_punch_type = 'out' and v_existing.out_time is not distinct from nullif(p_data->>'out_time', '')::time then
      raise exception 'Duplicate punch ignored — please wait a few seconds and try again';
    end if;
  end if;

  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source,
    field_note
  )
  values (
    p_emp_id, (p_data->>'date')::date, coalesce(nullif(p_data->>'day_type', ''), 'working'),
    nullif(p_data->>'in_time', '')::time, nullif(p_data->>'out_time', '')::time,
    p_data->>'in_location', p_data->>'out_location', p_data->>'leave_type', p_data->>'leave_reason',
    coalesce((p_data->>'wfh')::boolean, false), coalesce((p_data->>'on_duty')::boolean, false), p_data->>'status',
    p_data->>'late_hrs', p_data->>'early_hrs', p_data->>'bio_wrk_hrs', p_data->>'bio_ot',
    p_data->>'shift', p_data->>'shift_start', p_data->>'in_temp', p_data->>'out_temp',
    p_data->>'remark', p_data->>'card_no', p_data->>'designation', p_data->>'bio_status_raw',
    p_data->>'bio_source', p_data->>'monthly_source', p_data->>'source',
    p_data->>'field_note'
  )
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    field_note=excluded.field_note,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;
