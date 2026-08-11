-- HR request (2026-08-11): every employee gets a clean 4-digit code, and new hires
-- should get one automatically instead of admin typing one in. Confirmed with the user
-- before running this (again touches real, live-in-use identifying data for 133 people):
-- renumber literally everyone -- including the 82 who already had a real-looking
-- 4-digit code -- by joining date (oldest = most senior = lowest number), starting at
-- 1111. Real data going in was messy: 82 clean 4-digit codes, 29 old 8-digit codes
-- (e.g. "00000151"), 19 blank, 1 real duplicate (2376 shared by two people), a couple
-- of odd lengths. All of that gets replaced.
--
-- Guarded with an audit_logs marker, not just "renumber if anything looks messy" --
-- once every employee has a clean 4-digit code (true immediately after this runs, and
-- true forever after since admin_create_employee below always assigns one), a naive
-- "is anything not 4 digits" check would go permanently false and this would silently
-- become a no-op on every future migration replay anyway, EXCEPT if a future admin ever
-- hand-edits one employee's code into a non-4-digit value via the Edit form -- without
-- an explicit marker, that one edit would make the naive guard true again and
-- re-renumber all 133 people as a side effect. The audit_logs marker makes this
-- genuinely run-once, no matter what happens to individual emp_num values later.

do $$
begin
  if not exists (select 1 from audit_logs where action = 'EMP_NUM_RENUMBER_2026_08_11') then
    with ordered as (
      select id, row_number() over (order by joining_date asc nulls last, created_at asc) as rn
      from employees where deleted_at is null
    )
    update employees e
      set emp_num = lpad((1110 + o.rn)::text, 4, '0')
      from ordered o
      where e.id = o.id;

    perform log_audit('EMP_NUM_RENUMBER_2026_08_11',
      'One-time renumber of every employee to a clean 4-digit code, ordered by joining date, starting at 1111', 'system');
  end if;
end $$;

-- ============ admin_create_employee — always auto-assigns the next 4-digit code
-- (max existing numeric emp_num + 1), ignoring whatever the client sends for empNum.
-- Known accepted tradeoff, not a bug: no locking against two admins creating an
-- employee in the same instant -- realistic risk is effectively zero for this team's
-- size and the single shared admin PIN's inherently serial usage pattern. ============

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
    probation_end_date, work_mode, date_of_birth)
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
    nullif(p_data->>'dateOfBirth', '')::date
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
