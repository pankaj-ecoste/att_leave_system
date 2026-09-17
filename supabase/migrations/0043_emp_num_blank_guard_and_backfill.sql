-- HR-reported (2026-09-17): Aryan Negi's employee number showed blank. Root cause:
-- admin_update_employee's emp_num line was `coalesce(p_data->>'empNum', emp_num)` --
-- the only field in that function without a `nullif`, unlike joining_date/shift_type/
-- work_mode/date_of_birth. A whitespace-only edit in the Edit Employee form's "Emp
-- Number" box is truthy in JS, so it survives the client's empty->null conversion and
-- arrives as a literal " " -- which coalesce treats as "a real value" and writes over
-- the real number. See plan.md §27 for the full trace.
--
-- Fix has two parts:
--   1. admin_update_employee now uses nullif(btrim(...), '') for emp_num, same pattern
--      as every other optional-clear field in this function -- blank/whitespace input
--      always means "leave it alone", never "erase it".
--   2. One-time backfill of any row currently sitting blank, using the exact same
--      max(emp_num::int)+1 sequence admin_create_employee already uses for new hires.

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

-- ============ backfill: any row currently blank gets the next number in sequence,
-- oldest joining_date first (same tie-break admin_create_employee's ordering implies),
-- one at a time so two blank rows in the same run can't collide on the same number. ====

do $$
declare r record; v_next int;
begin
  for r in
    select id from employees
    where deleted_at is null and (emp_num is null or btrim(emp_num) = '')
    order by joining_date asc nulls last, created_at asc
  loop
    select coalesce(max(emp_num::int), 1110) + 1
      into v_next
      from employees where emp_num ~ '^[0-9]+$' and deleted_at is null;

    update employees set emp_num = lpad(v_next::text, 4, '0') where id = r.id;

    perform log_audit('EMP_NUM_BACKFILL_2026_09_17',
      'Assigned emp_num ' || lpad(v_next::text, 4, '0') || ' to employee ' || r.id || ' (was blank)', 'system');
  end loop;
end $$;
