-- plan.md §54 — Job Title / Department / Business Unit / Location become dropdowns.
--
-- The option lists live in one small table (kind + value) so HR can add a value without a code
-- change. The two employee save functions now REJECT a value that is not in the list (hard block,
-- not a warning). On UPDATE only a value that is actually being changed is checked, so an employee
-- who still holds an old value can be edited for something else. Blank is always allowed here — the
-- "required" rule for NEW employees is on the Add form.
--
-- Additive + two function replacements. admin_create_employee / admin_update_employee are copied
-- from the LIVE definitions (pg_get_functiondef, 2026-10-27) with only the check calls added — not
-- from an older migration file.

create table if not exists public.dropdown_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('job_title', 'department', 'business_unit', 'location')),
  value text not null check (value = btrim(value) and value <> '' and char_length(value) <= 80),
  created_at timestamptz not null default now()
);
-- "operator" and "Operator" are the same option: refuse the second one.
create unique index if not exists uq_dropdown_options_kind_value on public.dropdown_options (kind, lower(value));

alter table public.dropdown_options enable row level security;
revoke all on table public.dropdown_options from anon, authenticated;

-- ============ helpers (internal only) ============

create or replace function public.norm_option(p_text text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
$function$;

-- Raises unless p_value is blank or is an existing option of that kind.
create or replace function public.check_dropdown_value(p_kind text, p_label text, p_value text)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if p_value is null or btrim(p_value) = '' then return; end if;
  if not exists (select 1 from dropdown_options where kind = p_kind and value = p_value) then
    raise exception '% "%" is not in the list. Pick one from the dropdown, or add it first.', p_label, p_value;
  end if;
end;
$function$;

revoke all on function public.norm_option(text) from public, anon, authenticated;
revoke all on function public.check_dropdown_value(text, text, text) from public, anon, authenticated;

-- ============ admin functions ============

create or replace function public.admin_get_dropdown_options(p_token uuid)
 returns table(id uuid, kind text, value text, in_use bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select o.id, o.kind, o.value,
      case o.kind
        when 'job_title' then (select count(*) from employees e where e.deleted_at is null and e.job_title = o.value)
        when 'department' then (select count(*) from employees e where e.deleted_at is null and e.department = o.value)
        when 'business_unit' then (select count(*) from employees e where e.deleted_at is null and e.business_unit = o.value)
        else (select count(*) from employees e where e.deleted_at is null and e.location_info = o.value)
      end
    from dropdown_options o
    order by o.kind, lower(o.value);
end;
$function$;

create or replace function public.admin_add_dropdown_option(p_token uuid, p_kind text, p_value text)
 returns dropdown_options
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_val text; v_existing text; v_row dropdown_options;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_kind not in ('job_title', 'department', 'business_unit', 'location') then raise exception 'Unknown list'; end if;
  v_val := norm_option(p_value);
  if v_val = '' then raise exception 'Value cannot be blank'; end if;
  if char_length(v_val) > 80 then raise exception 'Value is too long (max 80 characters)'; end if;
  select value into v_existing from dropdown_options where kind = p_kind and lower(value) = lower(v_val);
  if v_existing is not null then raise exception '"%" already exists as "%"', v_val, v_existing; end if;
  insert into dropdown_options(kind, value) values (p_kind, v_val) returning * into v_row;
  perform log_audit('DROPDOWN_ADD', p_kind || ': ' || v_val, 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_remove_dropdown_option(p_token uuid, p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_opt dropdown_options; v_used bigint;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_opt from dropdown_options where id = p_id;
  if v_opt.id is null then raise exception 'Option not found'; end if;
  select count(*) into v_used from employees e
    where e.deleted_at is null and (
      case v_opt.kind
        when 'job_title' then e.job_title
        when 'department' then e.department
        when 'business_unit' then e.business_unit
        else e.location_info
      end) = v_opt.value;
  if v_used > 0 then
    raise exception '"%" is used by % employee(s) — move them to another value first', v_opt.value, v_used;
  end if;
  delete from dropdown_options where id = p_id;
  perform log_audit('DROPDOWN_REMOVE', v_opt.kind || ': ' || v_opt.value, 'admin');
  return true;
end;
$function$;

revoke all on function public.admin_get_dropdown_options(uuid) from public;
revoke all on function public.admin_add_dropdown_option(uuid, text, text) from public;
revoke all on function public.admin_remove_dropdown_option(uuid, uuid) from public;
grant execute on function public.admin_get_dropdown_options(uuid) to anon, authenticated;
grant execute on function public.admin_add_dropdown_option(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_remove_dropdown_option(uuid, uuid) to anon, authenticated;

-- ============ employee save functions: hard block on unknown values ============

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
  perform check_dropdown_value('job_title', 'Job Title', p_data->>'jobTitle');
  perform check_dropdown_value('department', 'Department', p_data->>'dept');
  perform check_dropdown_value('business_unit', 'Business Unit', p_data->>'bu');
  perform check_dropdown_value('location', 'Location', p_data->>'locationInfo');
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

create or replace function public.admin_update_employee(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_row employees; v_old employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  select * into v_old from employees where id = p_emp_id;
  -- Only a value that is being CHANGED must be in the list; an unchanged old value passes.
  if (p_data->>'jobTitle') is distinct from v_old.job_title then
    perform check_dropdown_value('job_title', 'Job Title', p_data->>'jobTitle'); end if;
  if (p_data->>'dept') is distinct from v_old.department then
    perform check_dropdown_value('department', 'Department', p_data->>'dept'); end if;
  if (p_data->>'bu') is distinct from v_old.business_unit then
    perform check_dropdown_value('business_unit', 'Business Unit', p_data->>'bu'); end if;
  if (p_data->>'locationInfo') is distinct from v_old.location_info then
    perform check_dropdown_value('location', 'Location', p_data->>'locationInfo'); end if;
  update employees set
    name=coalesce(p_data->>'name', name),
    pin=case when nullif(p_data->>'pin', '') is not null then crypt(p_data->>'pin', gen_salt('bf')) else pin end,
    company=coalesce(p_data->>'company', company),
    emp_num=coalesce(nullif(btrim(p_data->>'empNum'), ''), emp_num),
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
