-- HRMS — all business-logic functions (plan.md §3 counts 59; current_fy(), safe_numeric()
-- and log_audit() are utilities and live in 0002_hrms_schema.sql instead).
--
-- Every fix below traces to a specific defect in plan.md §4.1/§4.2/§4.3:
--   admin_create_employee / admin_update_employee / fetch_directory
--     -> insert/select business_unit/department/sub_department, not bu/dept/sub_dept
--   manager_decide_leave       -> leave_applications.updated_at now exists (0002)
--   admin_reset_leave_balances -> logs via by_name (log_audit), not the nonexistent performed_by
--   manager_get_team_leaves    -> orders by applied_at, not the nonexistent created_at
--   employee_login / admin_create_employee / admin_update_employee
--     -> PINs hashed with pgcrypto, never stored or compared as plaintext
--   admin_get_all_attendance / admin_get_all_leaves / admin_get_all_leave_balances
--     -> replaced by paginated admin_get_attendance / admin_get_leaves / admin_get_leave_balances
--        (§8B's one-month ceiling — the old versions returned every row, unbounded)
--
-- attendance.week_off (boolean) is gone — day_type ('working'/'week_off'/'holiday') is now
-- the single source of truth for what kind of day a row represents (§8B S-2c).

-- ============ SESSION VALIDATION ============

create or replace function public.is_valid_admin_token(p_token uuid)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from admin_sessions
    where token = p_token and expires_at > now()
  );
$function$;

create or replace function public.is_valid_employee_token(p_token uuid, p_emp_id uuid)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from employee_sessions where token = p_token and emp_id = p_emp_id and expires_at > now());
$function$;

-- ============ PUBLIC (PRE-LOGIN) ============

-- Re-run-safety fix (same class as the CREATE POLICY fix noted in PROGRESS.md):
-- a later migration (0005) changes this function's RETURNS TABLE column list, and
-- Postgres refuses `create or replace` across a shape change either direction. Without
-- this DROP, replaying every migration file from scratch (apply-migrations.mjs always
-- does) fails here the moment 0005 has already run once, because this statement would
-- be trying to shrink the shape back down. DROP IF EXISTS + CREATE works no matter
-- which shape the function is currently in.
drop function if exists public.fetch_directory();

create or replace function public.fetch_directory()
 returns table(id uuid, name text, company text, emp_num text, job_title text, bu text, dept text, sub_dept text, location_info text, cost_center text, manager text, email text, phone text, joining_date date, active boolean, shift_type text, manager_emp_id uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query select e.id, e.name, e.company, e.emp_num, e.job_title,
    e.business_unit, e.department, e.sub_department, e.location_info, e.cost_center,
    e.manager, e.email, e.phone, e.joining_date, e.active,
    e.shift_type, e.manager_emp_id
  from employees e where e.active = true order by e.name;
end;$function$;

-- ============ EMPLOYEE LOGIN / SESSION ============

create or replace function public.employee_login(p_employee_id uuid, p_pin text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pin_hash text; v_active boolean; v_attempts int; v_locked_until timestamptz; v_token uuid;
begin
  select pin, active, failed_pin_attempts, locked_until
    into v_pin_hash, v_active, v_attempts, v_locked_until
    from employees where id = p_employee_id;

  if v_pin_hash is null or not v_active then
    return jsonb_build_object('token', null, 'error', 'not_found');
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object('token', null, 'error', 'locked', 'locked_until', v_locked_until);
  end if;

  if v_pin_hash <> crypt(p_pin, v_pin_hash) then
    update employees set
      failed_pin_attempts = failed_pin_attempts + 1,
      locked_until = case when failed_pin_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where id = p_employee_id;
    return jsonb_build_object('token', null, 'error', 'wrong_pin');
  end if;

  update employees set failed_pin_attempts = 0, locked_until = null where id = p_employee_id;
  insert into employee_sessions (emp_id) values (p_employee_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'error', null);
end;
$function$;

create or replace function public.employee_logout(p_token uuid)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  with d as (delete from employee_sessions where token = p_token returning 1)
  select true;
$function$;

-- ============ EMPLOYEE — ATTENDANCE ============

create or replace function public.employee_get_attendance(p_token uuid, p_emp_id uuid, p_from date default null, p_to date default null)
 returns setof attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from attendance
    where emp_id = p_emp_id
    and (p_from is null or date >= p_from)
    and (p_to is null or date <= p_to)
    order by date desc;
end;
$function$;

create or replace function public.employee_punch(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row attendance;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source
  )
  values (
    p_emp_id, (p_data->>'date')::date, coalesce(nullif(p_data->>'day_type', ''), 'working'),
    nullif(p_data->>'in_time', '')::time, nullif(p_data->>'out_time', '')::time,
    p_data->>'in_location', p_data->>'out_location', p_data->>'leave_type', p_data->>'leave_reason',
    coalesce((p_data->>'wfh')::boolean, false), coalesce((p_data->>'on_duty')::boolean, false), p_data->>'status',
    p_data->>'late_hrs', p_data->>'early_hrs', p_data->>'bio_wrk_hrs', p_data->>'bio_ot',
    p_data->>'shift', p_data->>'shift_start', p_data->>'in_temp', p_data->>'out_temp',
    p_data->>'remark', p_data->>'card_no', p_data->>'designation', p_data->>'bio_status_raw',
    p_data->>'bio_source', p_data->>'monthly_source', p_data->>'source'
  )
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ EMPLOYEE — LEAVE ============

create or replace function public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_applications;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into leave_applications (emp_id, emp_name, company, leave_type, date, reason, location, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', p_data->>'leave_type', (p_data->>'date')::date, p_data->>'reason', p_data->>'location', 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.employee_get_leaves(p_token uuid, p_emp_id uuid)
 returns setof leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from leave_applications where emp_id = p_emp_id order by date desc;
end;
$function$;

create or replace function public.employee_get_leave_balances(p_token uuid, p_emp_id uuid)
 returns setof leave_balances
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from leave_balances where emp_id = p_emp_id and financial_year = current_fy();
end;
$function$;

-- ============ EMPLOYEE — REGULARIZATION ============

create or replace function public.employee_submit_regularization(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row regularization_requests;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  insert into regularization_requests(emp_id, date, requested_in, requested_out, reason)
  values(p_emp_id, p_date, p_in, p_out, p_reason) returning * into v_row;
  return v_row;
end;$function$;

create or replace function public.employee_get_regularizations(p_token uuid, p_emp_id uuid)
 returns setof regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from regularization_requests where emp_id = p_emp_id order by date desc;
end;$function$;

-- ============ EMPLOYEE — LOCATION / OD ============

create or replace function public.employee_log_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text default 'auto'::text)
 returns location_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row location_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  insert into location_logs(emp_id, date, lat_lon, type) values(p_emp_id, p_date, p_lat_lon, p_type) returning * into v_row;
  return v_row;
end;$function$;

create or replace function public.employee_log_od_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date)
 returns od_tracking_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row od_tracking_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into od_tracking_logs (emp_id, date, lat_lon) values (p_emp_id, p_date, p_lat_lon) returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.employee_get_od_logs(p_token uuid, p_emp_id uuid, p_date date)
 returns setof od_tracking_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from od_tracking_logs where emp_id = p_emp_id and date = p_date order by ts;
end;
$function$;

-- ============ MANAGER ============

create or replace function public.employee_get_my_team(p_token uuid, p_emp_id uuid)
 returns setof employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from employees where manager_emp_id = p_emp_id and active = true order by name;
end;$function$;

create or replace function public.manager_get_team_attendance(p_token uuid, p_manager_id uuid, p_month integer, p_year integer)
 returns setof attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select a.* from attendance a
    join employees e on e.id = a.emp_id
    where e.manager_emp_id = p_manager_id
    and extract(month from a.date) = p_month
    and extract(year from a.date) = p_year
    order by a.date, e.name;
end;$function$;

create or replace function public.manager_get_team_leaves(p_token uuid, p_manager_id uuid)
 returns setof leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select la.* from leave_applications la
    join employees e on e.id = la.emp_id
    where e.manager_emp_id = p_manager_id
    order by la.applied_at desc;
end;$function$;

create or replace function public.manager_decide_leave(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_applications;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  select la.* into v_row from leave_applications la
    join employees e on e.id = la.emp_id
    where la.id = p_leave_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  update leave_applications set status = p_status, updated_at = now() where id = p_leave_id returning * into v_row;
  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> ' || p_status, 'manager:' || p_manager_id);
  return v_row;
end;$function$;

create or replace function public.manager_get_team_regularizations(p_token uuid, p_manager_id uuid)
 returns setof regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select r.* from regularization_requests r
    join employees e on e.id = r.emp_id
    where e.manager_emp_id = p_manager_id
    order by r.created_at desc;
end;$function$;

create or replace function public.manager_decide_regularization(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row regularization_requests;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  select r.* into v_row from regularization_requests r
    join employees e on e.id = r.emp_id
    where r.id = p_reg_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  update regularization_requests set status = p_status, updated_at = now() where id = p_reg_id returning * into v_row;
  if p_status = 'Approved' then
    insert into attendance(emp_id, date, in_time, out_time, status, source)
    values(v_row.emp_id, v_row.date, v_row.requested_in, v_row.requested_out,
      case when v_row.requested_in is not null then 'Present' else 'Absent' end, 'regularization')
    on conflict(emp_id, date) do update set
      in_time = excluded.in_time, out_time = excluded.out_time,
      source = 'regularization', updated_at = now();
  end if;
  return v_row;
end;$function$;

-- ============ ADMIN — LOGIN / SETTINGS ============

create or replace function public.admin_login(p_pin text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_hash text; v_locked_until timestamptz; v_token uuid;
begin
  select admin_pin_hash, admin_locked_until into v_hash, v_locked_until from app_settings where id = 1;
  if v_locked_until is not null and v_locked_until > now() then return null; end if;
  if v_hash is null or v_hash <> crypt(p_pin, v_hash) then
    update app_settings set
      admin_failed_attempts = admin_failed_attempts + 1,
      admin_locked_until = case when admin_failed_attempts + 1 >= 5 then now() + interval '15 minutes' else admin_locked_until end
      where id = 1;
    return null;
  end if;
  update app_settings set admin_failed_attempts = 0, admin_locked_until = null where id = 1;
  insert into admin_sessions (token, expires_at) values (gen_random_uuid(), now() + interval '12 hours') returning token into v_token;
  return v_token;
end;
$function$;

create or replace function public.admin_logout(p_token uuid)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  with d as (delete from admin_sessions where token = p_token returning 1)
  select true;
$function$;

create or replace function public.admin_update_settings(p_token uuid, p_std_hours numeric, p_new_admin_pin text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_new_admin_pin is not null then
    update app_settings set std_hours = p_std_hours, admin_pin_hash = crypt(p_new_admin_pin, gen_salt('bf')) where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours || ', admin pin changed', 'admin');
  else
    update app_settings set std_hours = p_std_hours where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours, 'admin');
  end if;
  return true;
end;
$function$;

create or replace function public.admin_get_audit_logs(p_token uuid, p_limit integer default 500)
 returns setof audit_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from audit_logs order by ts desc limit p_limit;
end;
$function$;

-- ============ ADMIN — EMPLOYEES ============

create or replace function public.admin_get_employees(p_token uuid)
 returns setof employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from employees order by name;
end;
$function$;

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
    probation_end_date)
  values(
    p_data->>'name', crypt(coalesce(nullif(p_data->>'pin', ''), substr(md5(random()::text), 1, 4)), gen_salt('bf')),
    p_data->>'company',
    p_data->>'empNum', p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone',
    v_joining_date,
    coalesce(nullif(p_data->>'shiftType', ''), 'none'),
    nullif(p_data->>'managerEmpId', '')::uuid,
    case when v_joining_date is not null then (v_joining_date + interval '3 months')::date else null end
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
    manager_emp_id=case
      when p_data ? 'managerEmpId' then nullif(p_data->>'managerEmpId', '')::uuid
      else manager_emp_id
    end,
    updated_at=now()
  where id=p_emp_id returning * into v_row;
  perform log_audit('EMPLOYEE_UPDATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;$function$;

create or replace function public.admin_set_employment_status(p_token uuid, p_emp_id uuid, p_status text, p_probation_end_date date default null)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  if p_status not in ('Probation', 'Confirmed', 'Notice Period', 'Exited') then
    raise exception 'Invalid employment status: %', p_status;
  end if;
  update employees set
    employment_status = p_status,
    probation_end_date = coalesce(p_probation_end_date, probation_end_date),
    confirmed_on = case when p_status = 'Confirmed' and employment_status <> 'Confirmed' then current_date else confirmed_on end,
    updated_at = now()
  where id = p_emp_id
  returning * into v_row;
  perform log_audit('EMPLOYMENT_STATUS', v_row.name || ' -> ' || p_status, 'admin');
  return v_row;
end;$function$;

create or replace function public.admin_toggle_employee_status(p_token uuid, p_id uuid)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update employees set active = not active, updated_at = now() where id = p_id returning * into v_row;
  perform log_audit('EMPLOYEE_TOGGLE_ACTIVE', v_row.name || ' -> active=' || v_row.active, 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_delete_employee(p_token uuid, p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select name into v_name from employees where id = p_id;
  delete from employees where id = p_id;
  perform log_audit('EMPLOYEE_DELETE', coalesce(v_name, p_id::text), 'admin');
  return true;
end;
$function$;

-- ============ ADMIN — ATTENDANCE (paginated — §8B one-month ceiling) ============

create or replace function public.admin_get_attendance(
  p_token uuid, p_from date default null, p_to date default null,
  p_company text default null, p_emp_id uuid default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns setof attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select a.* from attendance a
    join employees e on e.id = a.emp_id
    where (p_from is null or a.date >= p_from)
      and (p_to is null or a.date <= p_to)
      and (p_company is null or e.company = p_company)
      and (p_emp_id is null or a.emp_id = p_emp_id)
    order by a.date desc, e.name
    limit p_limit offset p_offset;
end;
$function$;

create or replace function public.admin_upsert_attendance(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row attendance;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source
  )
  values (
    p_emp_id, (p_data->>'date')::date, coalesce(nullif(p_data->>'day_type', ''), 'working'),
    nullif(p_data->>'in_time', '')::time, nullif(p_data->>'out_time', '')::time,
    p_data->>'in_location', p_data->>'out_location', p_data->>'leave_type', p_data->>'leave_reason',
    coalesce((p_data->>'wfh')::boolean, false), coalesce((p_data->>'on_duty')::boolean, false), p_data->>'status',
    p_data->>'late_hrs', p_data->>'early_hrs', p_data->>'bio_wrk_hrs', p_data->>'bio_ot',
    p_data->>'shift', p_data->>'shift_start', p_data->>'in_temp', p_data->>'out_temp',
    p_data->>'remark', p_data->>'card_no', p_data->>'designation', p_data->>'bio_status_raw',
    p_data->>'bio_source', p_data->>'monthly_source', p_data->>'source'
  )
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.admin_bulk_upsert_attendance(p_token uuid, p_records jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source
  )
  select
    (r->>'emp_id')::uuid, (r->>'date')::date, coalesce(nullif(r->>'day_type', ''), 'working'),
    nullif(r->>'in_time', '')::time, nullif(r->>'out_time', '')::time,
    r->>'in_location', r->>'out_location', r->>'leave_type', r->>'leave_reason',
    coalesce((r->>'wfh')::boolean, false), coalesce((r->>'on_duty')::boolean, false), r->>'status',
    r->>'late_hrs', r->>'early_hrs', r->>'bio_wrk_hrs', r->>'bio_ot',
    r->>'shift', r->>'shift_start', r->>'in_temp', r->>'out_temp',
    r->>'remark', r->>'card_no', r->>'designation', r->>'bio_status_raw',
    r->>'bio_source', r->>'monthly_source', r->>'source'
  from jsonb_array_elements(p_records) as r
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    updated_at=now();
  get diagnostics v_count = row_count;
  perform log_audit('ATTENDANCE_BULK_IMPORT', v_count || ' rows', 'admin');
  return v_count;
end;
$function$;

-- ============ ADMIN — LEAVE (paginated) ============

create or replace function public.admin_get_leaves(
  p_token uuid, p_status text default null, p_from date default null, p_to date default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns setof leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select * from leave_applications
    where (p_status is null or status = p_status)
      and (p_from is null or date >= p_from)
      and (p_to is null or date <= p_to)
    order by date desc
    limit p_limit offset p_offset;
end;
$function$;

create or replace function public.admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_applications;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;
  update leave_applications set status = p_decision, updated_at = now() where id = p_leave_id returning * into v_row;
  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> ' || p_decision, 'admin');
  return v_row;
end;
$function$;

-- ============ ADMIN — LEAVE BALANCES (paginated) ============

create or replace function public.admin_get_leave_balances(
  p_token uuid, p_financial_year integer default null, p_limit integer default 1000, p_offset integer default 0
)
 returns setof leave_balances
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select * from leave_balances
    where financial_year = coalesce(p_financial_year, current_fy())
    order by emp_id, leave_type
    limit p_limit offset p_offset;
end;$function$;

create or replace function public.admin_upsert_leave_balance(p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_consumed numeric, p_balance numeric, p_quota numeric, p_unit text)
 returns leave_balances
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_balances;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values (p_emp_id, p_leave_type, p_accrued, p_consumed, p_balance, p_quota, p_unit)
  on conflict (emp_id, leave_type, financial_year) do update set
    accrued = excluded.accrued, consumed = excluded.consumed, balance = excluded.balance,
    quota = excluded.quota, unit = excluded.unit
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.admin_bulk_upsert_leave_balances(p_token uuid, p_records jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  insert into leave_balances(emp_id, leave_type, accrued, consumed, balance, quota, unit, financial_year)
  select
    (r->>'emp_id')::uuid,
    r->>'leave_type',
    coalesce(nullif(r->>'accrued', '')::numeric, 0),
    coalesce(nullif(r->>'consumed', '')::numeric, 0),
    coalesce(nullif(r->>'balance', '')::numeric, 0),
    coalesce(nullif(r->>'quota', '')::numeric, 0),
    coalesce(nullif(r->>'unit', ''), 'Days'),
    current_fy()
  from jsonb_array_elements(p_records) as r
  on conflict (emp_id, leave_type, financial_year) do update set
    accrued=excluded.accrued, consumed=excluded.consumed,
    balance=excluded.balance, quota=excluded.quota, unit=excluded.unit;
  get diagnostics v_count = row_count;
  perform log_audit('LEAVE_BALANCE_BULK_IMPORT', v_count || ' rows', 'admin');
  return v_count;
end;$function$;

create or replace function public.admin_fetch_all_leave_balances(p_token uuid)
 returns setof leave_balances
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from leave_balances where financial_year = current_fy() order by emp_id, leave_type;
end;$function$;

create or replace function public.admin_reset_leave_balances(p_token uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count int; v_new_fy int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_new_fy := current_fy() + 1;
  insert into leave_balances(emp_id, leave_type, accrued, consumed, balance, quota, unit, financial_year)
  select emp_id, leave_type, quota, 0, quota, quota, unit, v_new_fy
  from leave_balances
  where financial_year = current_fy()
  on conflict (emp_id, leave_type, financial_year) do nothing;
  get diagnostics v_count = row_count;
  perform log_audit('LEAVE_RESET', 'Financial year ' || v_new_fy || ' leave balances created', 'admin');
  return v_count;
end;$function$;

-- ============ ADMIN — HOLIDAYS ============

create or replace function public.admin_get_holidays(p_token uuid)
 returns setof holidays
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from holidays order by date;
end;
$function$;

create or replace function public.admin_add_holiday(p_token uuid, p_date date, p_name text, p_type text)
 returns holidays
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row holidays;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into holidays (date, name, type) values (p_date, p_name, p_type) returning * into v_row;
  perform log_audit('HOLIDAY_ADD', v_row.name || ' (' || v_row.date || ')', 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_delete_holiday(p_token uuid, p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  delete from holidays where id = p_id;
  return true;
end;
$function$;

-- ============ ADMIN — REGULARIZATIONS ============

create or replace function public.admin_get_regularizations(p_token uuid)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, requested_in time without time zone, requested_out time without time zone, reason text, status text, created_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select r.id, r.emp_id, e.name, e.emp_num, r.date, r.requested_in, r.requested_out, r.reason, r.status, r.created_at
    from regularization_requests r join employees e on e.id = r.emp_id
    order by r.created_at desc;
end;$function$;

create or replace function public.admin_decide_regularization(p_token uuid, p_id uuid, p_status text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row regularization_requests;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update regularization_requests set status=p_status, updated_at=now() where id=p_id returning * into v_row;
  if p_status='Approved' then
    insert into attendance(emp_id, date, in_time, out_time, status, source)
    values(v_row.emp_id, v_row.date, v_row.requested_in, v_row.requested_out,
           case when v_row.requested_in is not null then 'Present' else 'Absent' end, 'regularization')
    on conflict(emp_id, date) do update set
      in_time=excluded.in_time, out_time=excluded.out_time,
      source='regularization', updated_at=now();
  end if;
  return v_row;
end;$function$;

-- ============ ADMIN — LOCATION / OD LOGS ============

-- Dropped first, same reason as fetch_directory in 0005: a later migration
-- (0008_real_coords_background_tracking.sql) widens this function's RETURNS TABLE
-- column list, and Postgres refuses a plain CREATE OR REPLACE across a column-list
-- change. Without this guard, re-running every migration from scratch (which
-- apply-migrations.mjs always does) would recreate the narrow 8-column version here
-- and then fail trying to widen it back in 0008 — this makes the file order-independent
-- and genuinely re-run-safe regardless of what already landed after it.
drop function if exists public.admin_get_all_location_logs(uuid, date);

create or replace function public.admin_get_all_location_logs(p_token uuid, p_date date)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at
    from location_logs l join employees e on e.id = l.emp_id
    where l.date = p_date order by l.captured_at desc;
end;$function$;

create or replace function public.admin_get_location_logs(p_token uuid, p_emp_id uuid, p_date date)
 returns setof location_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from location_logs where emp_id = p_emp_id and date = p_date order by captured_at;
end;$function$;

create or replace function public.admin_get_od_logs(p_token uuid, p_emp_id uuid, p_date date)
 returns setof od_tracking_logs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from od_tracking_logs where emp_id = p_emp_id and date = p_date order by ts;
end;
$function$;

-- ============ ADMIN — IMPORT SHEET CACHES ============

create or replace function public.admin_get_imported_sheet(p_token uuid)
 returns imported_sheet_cache
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row imported_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_row from imported_sheet_cache where id = 1;
  return v_row;
end;
$function$;

create or replace function public.admin_set_imported_sheet(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb)
 returns imported_sheet_cache
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row imported_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update imported_sheet_cache set filename = p_filename, cols = p_cols, rows = p_rows, imported_at = now() where id = 1
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.admin_clear_imported_sheet(p_token uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update imported_sheet_cache set filename = null, cols = '[]'::jsonb, rows = '[]'::jsonb, imported_at = null where id = 1;
  return true;
end;
$function$;

create or replace function public.admin_get_bio_sheet(p_token uuid)
 returns bio_sheet_cache
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row bio_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_row from bio_sheet_cache where id = 1;
  return v_row;
end;
$function$;

create or replace function public.admin_set_bio_sheet(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_date date, p_synced integer, p_skipped integer)
 returns bio_sheet_cache
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row bio_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update bio_sheet_cache set filename=p_filename, cols=p_cols, rows=p_rows, report_date=p_report_date, synced=p_synced, skipped=p_skipped, imported_at=now() where id = 1
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.admin_clear_bio_sheet(p_token uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update bio_sheet_cache set filename=null, cols='[]'::jsonb, rows='[]'::jsonb, report_date=null, synced=null, skipped=null, imported_at=null where id = 1;
  return true;
end;
$function$;

create or replace function public.admin_get_monthly_sheet(p_token uuid)
 returns monthly_sheet_cache
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row monthly_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_row from monthly_sheet_cache where id = 1;
  return v_row;
end;
$function$;

create or replace function public.admin_set_monthly_sheet(p_token uuid, p_filename text, p_report_month integer, p_report_year integer, p_synced integer, p_skipped integer)
 returns monthly_sheet_cache
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row monthly_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update monthly_sheet_cache set filename=p_filename, report_month=p_report_month, report_year=p_report_year, synced=p_synced, skipped=p_skipped, imported_at=now() where id = 1
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.admin_clear_monthly_sheet(p_token uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update monthly_sheet_cache set filename=null, report_month=null, report_year=null, synced=null, skipped=null, imported_at=null where id = 1;
  return true;
end;
$function$;

-- ============ EXECUTE GRANTS (P1-3) ============
-- Miss this and every RPC call 404s for anon — the classic Supabase migration trap.
-- One block at the end so it's obvious nothing was missed.

grant execute on function
  public.is_valid_admin_token(uuid),
  public.is_valid_employee_token(uuid, uuid),
  public.fetch_directory(),
  public.employee_login(uuid, text),
  public.employee_logout(uuid),
  public.employee_get_attendance(uuid, uuid, date, date),
  public.employee_punch(uuid, uuid, jsonb),
  public.employee_apply_leave(uuid, uuid, jsonb),
  public.employee_get_leaves(uuid, uuid),
  public.employee_get_leave_balances(uuid, uuid),
  public.employee_submit_regularization(uuid, uuid, date, time, time, text),
  public.employee_get_regularizations(uuid, uuid),
  public.employee_log_location(uuid, uuid, text, date, text),
  public.employee_log_od_location(uuid, uuid, text, date),
  public.employee_get_od_logs(uuid, uuid, date),
  public.employee_get_my_team(uuid, uuid),
  public.manager_get_team_attendance(uuid, uuid, integer, integer),
  public.manager_get_team_leaves(uuid, uuid),
  public.manager_decide_leave(uuid, uuid, uuid, text),
  public.manager_get_team_regularizations(uuid, uuid),
  public.manager_decide_regularization(uuid, uuid, uuid, text),
  public.admin_login(text),
  public.admin_logout(uuid),
  public.admin_update_settings(uuid, numeric, text),
  public.admin_get_audit_logs(uuid, integer),
  public.admin_get_employees(uuid),
  public.admin_create_employee(uuid, jsonb),
  public.admin_update_employee(uuid, uuid, jsonb),
  public.admin_set_employment_status(uuid, uuid, text, date),
  public.admin_toggle_employee_status(uuid, uuid),
  public.admin_delete_employee(uuid, uuid),
  public.admin_get_attendance(uuid, date, date, text, uuid, integer, integer),
  public.admin_upsert_attendance(uuid, uuid, jsonb),
  public.admin_bulk_upsert_attendance(uuid, jsonb),
  public.admin_get_leaves(uuid, text, date, date, integer, integer),
  public.admin_decide_leave(uuid, uuid, text),
  public.admin_get_leave_balances(uuid, integer, integer, integer),
  public.admin_upsert_leave_balance(uuid, uuid, text, numeric, numeric, numeric, numeric, text),
  public.admin_bulk_upsert_leave_balances(uuid, jsonb),
  public.admin_fetch_all_leave_balances(uuid),
  public.admin_reset_leave_balances(uuid),
  public.admin_get_holidays(uuid),
  public.admin_add_holiday(uuid, date, text, text),
  public.admin_delete_holiday(uuid, uuid),
  public.admin_get_regularizations(uuid),
  public.admin_decide_regularization(uuid, uuid, text),
  public.admin_get_all_location_logs(uuid, date),
  public.admin_get_location_logs(uuid, uuid, date),
  public.admin_get_od_logs(uuid, uuid, date),
  public.admin_get_imported_sheet(uuid),
  public.admin_set_imported_sheet(uuid, text, jsonb, jsonb),
  public.admin_clear_imported_sheet(uuid),
  public.admin_get_bio_sheet(uuid),
  public.admin_set_bio_sheet(uuid, text, jsonb, jsonb, date, integer, integer),
  public.admin_clear_bio_sheet(uuid),
  public.admin_get_monthly_sheet(uuid),
  public.admin_set_monthly_sheet(uuid, text, integer, integer, integer, integer),
  public.admin_clear_monthly_sheet(uuid)
to anon;
