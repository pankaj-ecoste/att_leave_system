-- plan.md §16 — per-employee 8-hour shift override. Only 2 people in the org are on an
-- 8h shift (Archana emp #1113, Vivek Singh emp #1154); everyone else stays on the
-- existing global 9h default (app_settings.std_hours, untouched by this migration).
--
-- Root cause this replaces: the only previous way to special-case these two was
-- changing the *global* std_hours, which is exactly what caused the §15.2 incident
-- (broke Present/Absent for the other ~98% of staff). This makes std_hours resolvable
-- per employee instead, with `null` meaning "use the org default."

-- ============ 1. employees.std_hours_override ============
-- Nullable, deliberately not reusing shift_type (day/night label, unrelated concept).

alter table employees add column if not exists std_hours_override numeric;

-- ============ 2. fetch_directory — add std_hours_override ============
-- Postgres refuses `create or replace` when a function's RETURNS TABLE column list
-- changes ("cannot change return type of existing function") — has to be dropped first,
-- same pattern 0005 already used when it last extended this function's return shape.

drop function if exists public.fetch_directory();

create or replace function public.fetch_directory()
 returns table(id uuid, name text, company text, emp_num text, job_title text, bu text, dept text, sub_dept text, location_info text, cost_center text, manager text, email text, phone text, joining_date date, active boolean, shift_type text, manager_emp_id uuid, work_mode text, std_hours_override numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query select e.id, e.name, e.company, e.emp_num, e.job_title,
    e.business_unit, e.department, e.sub_department, e.location_info, e.cost_center,
    e.manager, e.email, e.phone, e.joining_date, e.active,
    e.shift_type, e.manager_emp_id, e.work_mode, e.std_hours_override
  from employees e where e.active = true order by e.name;
end;$function$;

-- ============ 3. employees_directory view — add std_hours_override ============
-- CREATE OR REPLACE VIEW can only append columns, never drop/reorder them, so plain
-- append (no drop) is safe here, same as every other column this view has picked up
-- since 0002 (see the note already in 0002_hrms_schema.sql about 0020/0023 doing this).

create or replace view public.employees_directory as
  select id, name, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, manager_emp_id, email, phone, joining_date,
    active, shift_type, std_hours_override
  from employees
  where active = true
  order by name;

grant select on public.employees_directory to anon;

-- ============ 4. get_effective_std_hours — single fresh per-employee lookup ============
-- Mirrors the existing "fetch fresh, never trust a stale prop" pattern already used for
-- app_settings.std_hours at the two places that actually WRITE a computed status
-- (useEmployeeAttendance's punch flow, useAdminAttendance's editCell) — plan.md §15.2.
-- Anon-executable like app_settings_public, since it runs before/around employee login.

create or replace function public.get_effective_std_hours(p_emp_id uuid)
 returns numeric
 language sql
 security definer
 set search_path to 'public'
as $function$
  select coalesce(e.std_hours_override, s.std_hours)
  from app_settings s
  left join employees e on e.id = p_emp_id
  where s.id = 1;
$function$;

grant execute on function public.get_effective_std_hours(uuid) to anon;
grant execute on function public.get_effective_std_hours(uuid) to authenticated;

-- ============ 5. admin_create_employee — add std_hours_override ============
-- Full current body copied from 0030_employee_code_renumber_and_autoincrement.sql
-- (create or replace fully overwrites a function body, it doesn't merge — this project
-- has been bitten by that twice before per 0023's own write-up, so the complete live
-- body is reproduced here rather than a partial redefinition).

create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_row employees; v_joining_date date; v_months numeric;
  v_cl_quota numeric; v_el_quota numeric; v_el_advance numeric; v_emp_num text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_joining_date := nullif(p_data->>'joiningDate', '')::date;

  -- deleted_at is null matters here: a soft-deleted employee can still have a stray
  -- high emp_num (found one from earlier ad-hoc testing, '9021') that must not leak
  -- into the sequence for real new hires.
  select lpad((coalesce(max(emp_num::int), 1110) + 1)::text, 4, '0')
    into v_emp_num
    from employees where emp_num ~ '^[0-9]+$' and deleted_at is null;

  insert into employees(name, pin, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, email, phone, joining_date, shift_type, manager_emp_id,
    probation_end_date, work_mode, date_of_birth, std_hours_override)
  values(
    p_data->>'name', crypt(coalesce(nullif(p_data->>'pin', ''), substr(md5(random()::text), 1, 4)), gen_salt('bf')),
    p_data->>'company',
    v_emp_num, p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone', v_joining_date,
    coalesce(nullif(p_data->>'shiftType', ''), 'none'),
    nullif(p_data->>'managerEmpId', '')::uuid,
    case when v_joining_date is not null then (v_joining_date + interval '3 months')::date else null end,
    coalesce(nullif(p_data->>'workMode', ''), 'office'),
    nullif(p_data->>'dateOfBirth', '')::date,
    nullif(p_data->>'stdHoursOverride', '')::numeric
  )
  returning * into v_row;

  v_months := months_remaining_in_fy(v_joining_date);
  v_cl_quota := least(12, v_months);
  v_el_quota := least(6, v_months * 0.5);
  -- Advance model, EL only: same immediate credit-at-hire the pre-0026 version had.
  v_el_advance := least(v_el_quota, months_elapsed_in_fy_advance(v_joining_date) * 0.5);

  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values
    (v_row.id, 'Casual Leave', 0, 0, 0, v_cl_quota, 'Days'),
    (v_row.id, 'Earned Leave', v_el_advance, 0, v_el_advance, v_el_quota, 'Days'),
    (v_row.id, 'Sick Leave', 4, 0, 4, 4, 'Days')
  on conflict (emp_id, leave_type, financial_year) do nothing;

  perform log_audit('EMPLOYEE_CREATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;
$function$;

-- ============ 6. admin_update_employee — add std_hours_override ============
-- Full current body copied from 0023_v2_phase_a.sql. Uses the same `p_data ? 'key'`
-- existence-check pattern already used for manager_emp_id just below it, so the admin
-- can explicitly clear an override back to null (blank field), not just set a new one —
-- coalesce(nullif(...), col) alone can never write null over an existing value.

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
    date_of_birth=coalesce(nullif(p_data->>'dateOfBirth', '')::date, date_of_birth),
    manager_emp_id=case
      when p_data ? 'managerEmpId' then nullif(p_data->>'managerEmpId', '')::uuid
      else manager_emp_id
    end,
    std_hours_override=case
      when p_data ? 'stdHoursOverride' then nullif(p_data->>'stdHoursOverride', '')::numeric
      else std_hours_override
    end,
    updated_at=now()
  where id=p_emp_id returning * into v_row;
  perform log_audit('EMPLOYEE_UPDATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;$function$;

-- ============ 7. run_comp_off_accrual — respect the per-employee override ============
-- Full current body copied from 0024_v2_phase_c_comp_off_and_accrual.sql. Was a single
-- global v_std_hours; now resolved per row (coalesce override, org default) so the two
-- 8h employees earn a comp-off credit for 8h worked on a Sunday/holiday, matching their
-- daily target, instead of needing the org's 9h (plan.md §16 decision 6).

create or replace function public.run_comp_off_accrual()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_default_std_hours numeric;
  v_count int := 0;
  v_rec record;
  v_hours numeric;
  v_row_std_hours numeric;
  v_new_balance numeric;
begin
  select std_hours into v_default_std_hours from app_settings where id = 1;

  for v_rec in
    select a.emp_id, a.date, a.in_time, a.out_time, coalesce(e.std_hours_override, v_default_std_hours) as std_hours
    from attendance a
    join employees e on e.id = a.emp_id
    where a.date >= current_date - interval '7 days' and a.date < current_date
      and a.in_time is not null and a.out_time is not null
      and e.deleted_at is null and e.active
      and (extract(dow from a.date) = 0 or exists (select 1 from holidays h where h.date = a.date))
      and not exists (
        select 1 from leave_accruals la
        where la.emp_id = a.emp_id and la.leave_type = 'Compensatory Leave' and la.period = a.date
      )
  loop
    v_row_std_hours := v_rec.std_hours;
    v_hours := extract(epoch from (
      case when v_rec.out_time < v_rec.in_time
        then v_rec.out_time + interval '24 hours' - v_rec.in_time
        else v_rec.out_time - v_rec.in_time
      end
    )) / 3600.0;

    if v_hours >= v_row_std_hours then
      insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
      values (v_rec.emp_id, 'Compensatory Leave', 0, 0, 0, 0, 'Days')
      on conflict (emp_id, leave_type, financial_year) do nothing;

      update leave_balances set accrued = accrued + 1, balance = balance + 1
        where emp_id = v_rec.emp_id and leave_type = 'Compensatory Leave' and financial_year = current_fy()
        returning balance into v_new_balance;

      insert into leave_accruals (emp_id, leave_type, period, credited, running_balance, note)
      values (v_rec.emp_id, 'Compensatory Leave', v_rec.date, 1, v_new_balance, 'worked_day_credit')
      on conflict (emp_id, leave_type, period) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  perform log_audit('COMP_OFF_ACCRUAL', v_count || ' comp-off credits', 'system');
  return v_count;
end;
$function$;

-- ============ 8. Set the override for the 2 employees HR named ============
-- Archana (emp #1113), Vivek Singh (emp #1154) -> 8h. Looked up by emp_num (readable,
-- re-runnable) rather than a hardcoded UUID. Guarded so it only ever touches exactly
-- these two and only runs once.

do $$
declare
  v_updated int;
begin
  if not exists (select 1 from audit_logs where action = 'STD_HOURS_OVERRIDE_2026_09_04') then
    update employees set std_hours_override = 8
      where emp_num in ('1113', '1154') and deleted_at is null;
    get diagnostics v_updated = row_count;

    if v_updated <> 2 then
      raise exception 'Expected to update exactly 2 employees (emp_num 1113, 1154), updated %. Check emp_num values before re-running.', v_updated;
    end if;

    perform log_audit('STD_HOURS_OVERRIDE_2026_09_04',
      'Set std_hours_override=8 for emp_num 1113 (Archana) and 1154 (Vivek Singh) — plan.md §16', 'admin');
  end if;
end $$;
