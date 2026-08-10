-- V2 Phase A (plan.md §11 / PROGRESS.md "📅 V2"): Plant company + leave restriction,
-- Date of Birth + birthday notifications, per-employee asset management. Nothing here
-- touches attendance/leave calculations — purely additive, per the phase's own "safe to
-- build first" rationale.
--
-- VA-1/VA-2 (Plant tile + UI-hidden leave types) are frontend-only — COMPANIES gained a
-- 4th entry and the leave-type filter already lives in lib/constants.js /
-- hooks/useEmployeeLeave.js. This migration is VA-3 (server-side enforcement) onward.

-- ============ VA-3 — employee_apply_leave blocks the 8 restricted types for Plant ============
-- Keyed off the employee's real `employees.company` column, not the client-supplied
-- p_data->>'company' value that's only ever used for display/denormalization on the
-- leave_applications row itself (same reasoning as every other server-side guardrail in
-- this function — hiding a button is not enforcement).

create or replace function public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_leave_type text := p_data->>'leave_type';
  v_day_part text := coalesce(nullif(p_data->>'day_part', ''), 'full');
  v_date date := (p_data->>'date')::date;
  v_balance numeric;
  v_needed numeric;
  v_emp_status text;
  v_joining_date date;
  v_company text;
  v_capped_leave_count int;
  v_fy_start date;
  v_fy_end date;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  if v_day_part not in ('full', 'first_half', 'second_half') then
    raise exception 'Invalid day part';
  end if;
  if v_day_part != 'full' and v_leave_type not in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    raise exception 'Half-day is only available for Sick, Casual and Earned Leave';
  end if;

  if v_leave_type = 'Earned Leave' and v_date < current_date + 7 then
    raise exception 'Earned Leave must be applied at least 7 days in advance';
  elsif v_leave_type not in ('Sick Leave', 'Bereavement Leave', 'Work From Home', 'On Duty', 'LOP', 'Earned Leave')
        and v_date < current_date + 1 then
    raise exception '% must be applied at least a day in advance', v_leave_type;
  end if;

  if exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and date = v_date and status != 'Rejected'
  ) then
    raise exception 'A leave application already exists for %', v_date;
  end if;

  select employment_status, joining_date, company into v_emp_status, v_joining_date, v_company from employees where id = p_emp_id;

  -- V2 decision 3 (plan.md §11) — 8 leave types are off-limits for Production Plant
  -- employees. Checked against the authoritative employees.company, not client input.
  if v_company = 'Asma + Production Plant'
     and v_leave_type in ('Bereavement Leave', 'Marriage Leave', 'Maternity Leave', 'Paternity Leave',
                           'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Work From Home', 'On Duty') then
    raise exception '% is not available for Production Plant employees', v_leave_type;
  end if;

  if v_emp_status in ('Probation', 'Notice Period')
     and v_leave_type not in ('LOP', 'Work From Home', 'On Duty') then
    v_fy_start := make_date(current_fy(), 4, 1);
    v_fy_end := make_date(current_fy() + 1, 3, 31);
    select count(*) into v_capped_leave_count from leave_applications
      where emp_id = p_emp_id and status != 'Rejected'
        and leave_type not in ('LOP', 'Work From Home', 'On Duty')
        and date between v_fy_start and v_fy_end;
    if v_capped_leave_count >= 1 then
      raise exception 'Only 1 leave is allowed during your % — apply as LOP instead', v_emp_status;
    end if;
  end if;

  if v_leave_type in ('Marriage Leave', 'Maternity Leave')
     and (v_joining_date is null or v_joining_date > (current_date - interval '18 months')) then
    raise exception '% requires at least 18 months of service', v_leave_type;
  end if;

  if v_leave_type = 'Sick Leave' and coalesce(p_data->>'document_path', '') = '' then
    raise exception 'A medical certificate/prescription is required to apply for Sick Leave';
  end if;

  if v_leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    v_needed := case when v_day_part = 'full' then 1 else 0.5 end;
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = v_leave_type and financial_year = current_fy();
    if v_balance is not null and v_balance < v_needed then
      raise exception 'Insufficient % balance — % remaining this year', v_leave_type, v_balance;
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, document_path, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', nullif(p_data->>'document_path', ''), 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ VA-4 — Date of Birth ============

alter table employees add column if not exists date_of_birth date;

-- admin_create_employee / admin_update_employee gain date_of_birth. Also restores two
-- things silently dropped when 0014 last redefined admin_create_employee (create or
-- replace fully overwrites a function body, it doesn't merge): the `work_mode` column
-- (0005 added it, 0014's version omitted it from the insert, so every new hire since has
-- silently defaulted to 'office' regardless of what admin picked in the form) and the
-- `log_audit('EMPLOYEE_CREATE', ...)` call (0005 added it, 0014's version dropped it, so
-- employee creation stopped being audit-logged while every other admin action still is).
-- Same class of bug this project has been bitten by twice before (0014/0018 write-ups) —
-- caught this time by re-reading the live function body before extending it again.
create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_row employees; v_joining_date date; v_months numeric; v_cl numeric; v_el numeric;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_joining_date := nullif(p_data->>'joiningDate', '')::date;
  insert into employees(name, pin, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, email, phone, joining_date, shift_type, manager_emp_id,
    probation_end_date, work_mode, date_of_birth)
  values(
    p_data->>'name', crypt(coalesce(nullif(p_data->>'pin', ''), substr(md5(random()::text), 1, 4)), gen_salt('bf')),
    p_data->>'company',
    p_data->>'empNum', p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone', v_joining_date,
    coalesce(nullif(p_data->>'shiftType', ''), 'none'),
    nullif(p_data->>'managerEmpId', '')::uuid,
    case when v_joining_date is not null then (v_joining_date + interval '3 months')::date else null end,
    coalesce(nullif(p_data->>'workMode', ''), 'office'),
    nullif(p_data->>'dateOfBirth', '')::date
  )
  returning * into v_row;

  v_months := months_remaining_in_fy(v_joining_date);
  v_cl := least(12, v_months);
  v_el := least(6, v_months * 0.5);
  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values
    (v_row.id, 'Casual Leave', v_cl, 0, v_cl, v_cl, 'Days'),
    (v_row.id, 'Earned Leave', v_el, 0, v_el, v_el, 'Days'),
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
    updated_at=now()
  where id=p_emp_id returning * into v_row;
  perform log_audit('EMPLOYEE_UPDATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;$function$;

-- ============ VA-5/6/7 — Birthday notifications ============
-- date_of_birth deliberately stays OUT of fetch_directory / employees_directory (the
-- pre-login public listing) — broadcasting every employee's birthdate to an
-- unauthenticated screen would be a real new PII exposure this app doesn't currently
-- have, unlike name/company/job title which were already a deliberate tradeoff.
-- employee_get_birthday_today only ever answers "is it MY birthday" for the logged-in
-- caller, never returns the date itself.

create table if not exists "public"."birthday_wish_acks" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "wish_date" date not null,
  "acked_at" timestamp with time zone default now() not null,
  "acked_by" text,
  unique (emp_id, wish_date)
);
alter table birthday_wish_acks enable row level security;

create or replace function public.employee_get_birthday_today(p_token uuid, p_emp_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_dob date;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  select date_of_birth into v_dob from employees where id = p_emp_id;
  return v_dob is not null
    and extract(month from v_dob) = extract(month from current_date)
    and extract(day from v_dob) = extract(day from current_date);
end;
$function$;

grant execute on function public.employee_get_birthday_today(uuid, uuid) to anon;

create or replace function public.admin_get_todays_birthdays(p_token uuid)
 returns table(emp_id uuid, name text, company text, acked boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select e.id, e.name, e.company,
      exists(select 1 from birthday_wish_acks a where a.emp_id = e.id and a.wish_date = current_date) as acked
    from employees e
    where e.deleted_at is null and e.active and e.date_of_birth is not null
      and extract(month from e.date_of_birth) = extract(month from current_date)
      and extract(day from e.date_of_birth) = extract(day from current_date)
    order by e.name;
end;
$function$;

grant execute on function public.admin_get_todays_birthdays(uuid) to anon;

create or replace function public.admin_mark_birthday_wished(p_token uuid, p_emp_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into birthday_wish_acks (emp_id, wish_date, acked_by) values (p_emp_id, current_date, 'admin')
    on conflict (emp_id, wish_date) do nothing;
  return true;
end;
$function$;

grant execute on function public.admin_mark_birthday_wished(uuid, uuid) to anon;

-- Message template lives in Settings (VA-7), editable without a code change — {name} is
-- replaced client-side with the logged-in employee's own name. Ships with HR's draft
-- wording as a placeholder; `coalesce` on the update below means re-running this
-- migration never clobbers a value an admin has since edited from Settings.
alter table app_settings add column if not exists birthday_message text;
update app_settings set birthday_message = coalesce(birthday_message,
  'Happy Birthday {name}! May Supreme Energy bless you. We are thankful to have you in our workspace. — By Ankur Hora and Team')
  where id = 1;

-- Same "new argument list creates a new overload" gotcha documented in 0018/0020 —
-- explicitly drop the current 5-argument signature before redefining with a 6th.
drop function if exists public.admin_update_settings(uuid, numeric, text, text, text);

create or replace function public.admin_update_settings(
  p_token uuid, p_std_hours numeric, p_new_admin_pin text default null::text,
  p_old_pin text default null::text, p_admin_email text default null::text,
  p_birthday_message text default null::text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_current_hash text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_new_admin_pin is not null then
    select admin_pin_hash into v_current_hash from app_settings where id = 1;
    if p_old_pin is null or crypt(p_old_pin, v_current_hash) is distinct from v_current_hash then
      raise exception 'Current PIN is incorrect';
    end if;
    update app_settings set
      std_hours = p_std_hours,
      admin_pin_hash = crypt(p_new_admin_pin, gen_salt('bf')),
      admin_email = coalesce(p_admin_email, admin_email),
      birthday_message = coalesce(p_birthday_message, birthday_message)
      where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours || ', admin pin changed', 'admin');
  else
    update app_settings set
      std_hours = p_std_hours,
      admin_email = coalesce(p_admin_email, admin_email),
      birthday_message = coalesce(p_birthday_message, birthday_message)
      where id = 1;
    perform log_audit('SETTINGS_UPDATE', 'std_hours=' || p_std_hours, 'admin');
  end if;
  return true;
end;
$function$;

grant execute on function public.admin_update_settings(uuid, numeric, text, text, text, text) to anon;

create or replace view public.app_settings_public as
  select std_hours, admin_email, birthday_message from app_settings where id = 1;

-- ============ VA-8/9/10/11 — Asset management ============

create table if not exists "public"."employee_assets" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "asset_type" text not null,
  "serial_number" text,
  "assigned_date" date,
  "status" text,
  "assigned_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create index if not exists idx_employee_assets_emp_id on employee_assets (emp_id);
alter table employee_assets enable row level security;

-- Exit/offboarding (V2 decision 23) is one confirmation flag, not per-item return
-- tracking — admin marks everything returned in one action once the employee is Exited.
alter table employees add column if not exists assets_returned boolean not null default false;
alter table employees add column if not exists assets_returned_at timestamp with time zone;
alter table employees add column if not exists assets_returned_by text;

create or replace function public.admin_get_employee_assets(p_token uuid, p_emp_id uuid)
 returns setof employee_assets
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from employee_assets where emp_id = p_emp_id order by assigned_date desc nulls last, created_at desc;
end;
$function$;

grant execute on function public.admin_get_employee_assets(uuid, uuid) to anon;

create or replace function public.employee_get_own_assets(p_token uuid, p_emp_id uuid)
 returns setof employee_assets
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from employee_assets where emp_id = p_emp_id order by assigned_date desc nulls last, created_at desc;
end;
$function$;

grant execute on function public.employee_get_own_assets(uuid, uuid) to anon;

create or replace function public.admin_upsert_employee_asset(
  p_token uuid, p_asset_id uuid, p_emp_id uuid, p_asset_type text,
  p_serial_number text default null::text, p_assigned_date date default null::date,
  p_status text default null::text, p_assigned_by text default null::text
)
 returns employee_assets
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row employee_assets; v_emp_name text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select name into v_emp_name from employees where id = p_emp_id;
  if p_asset_id is null then
    insert into employee_assets (emp_id, asset_type, serial_number, assigned_date, status, assigned_by)
    values (p_emp_id, p_asset_type, nullif(p_serial_number, ''), p_assigned_date, nullif(p_status, ''), nullif(p_assigned_by, ''))
    returning * into v_row;
    perform log_audit('ASSET_ASSIGN', p_asset_type || ' -> ' || coalesce(v_emp_name, p_emp_id::text), 'admin');
  else
    update employee_assets set
      asset_type = p_asset_type,
      serial_number = nullif(p_serial_number, ''),
      assigned_date = p_assigned_date,
      status = nullif(p_status, ''),
      assigned_by = nullif(p_assigned_by, ''),
      updated_at = now()
    where id = p_asset_id and emp_id = p_emp_id
    returning * into v_row;
    perform log_audit('ASSET_UPDATE', p_asset_type || ' -> ' || coalesce(v_emp_name, p_emp_id::text), 'admin');
  end if;
  return v_row;
end;
$function$;

grant execute on function public.admin_upsert_employee_asset(uuid, uuid, uuid, text, text, date, text, text) to anon;

create or replace function public.admin_delete_employee_asset(p_token uuid, p_asset_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_asset_type text; v_emp_name text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select ea.asset_type, e.name into v_asset_type, v_emp_name
    from employee_assets ea join employees e on e.id = ea.emp_id where ea.id = p_asset_id;
  delete from employee_assets where id = p_asset_id;
  perform log_audit('ASSET_DELETE', coalesce(v_asset_type, p_asset_id::text) || ' -> ' || coalesce(v_emp_name, ''), 'admin');
  return true;
end;
$function$;

grant execute on function public.admin_delete_employee_asset(uuid, uuid) to anon;

create or replace function public.admin_mark_assets_returned(p_token uuid, p_emp_id uuid)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row employees; v_status text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select employment_status into v_status from employees where id = p_emp_id;
  if v_status is distinct from 'Exited' then
    raise exception 'Assets can only be marked returned once the employee is Exited';
  end if;
  update employees set assets_returned = true, assets_returned_at = now(), assets_returned_by = 'admin', updated_at = now()
    where id = p_emp_id returning * into v_row;
  perform log_audit('ASSETS_RETURNED', v_row.name, 'admin');
  return v_row;
end;
$function$;

grant execute on function public.admin_mark_assets_returned(uuid, uuid) to anon;
