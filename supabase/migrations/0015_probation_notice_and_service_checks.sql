-- Day 3 midday — probation/notice leave cap + 18-month service check for
-- Marriage/Maternity (plan.md Day 3, PROGRESS.md P4B-9, P4B-10).
--
-- Policy doc (ATPL|HR|22|1002):
--   "Probation Period ... Only 1 leave will be applicable in the probation period. If
--    the employee still wishes to take any further leave it will be counted in LOP."
--   "NOTICE PERIOD ... Only 1 leave will be applicable in the notice period. If the
--    employee still wishes to take any leave it will be counted in LOP."
--   "Marriage Leaves / Maternity Leaves ... worked for at least 18 months."
--
-- A known, documented simplification: the "1 leave" count is scoped to the current
-- financial year, not to the exact probation/notice window — there's no
-- probation-start or notice-start date column to anchor a tighter window to (only
-- `joining_date` and `confirmed_on`), and probation/notice periods are a few months
-- long in practice, well inside one FY. Same posture as the bio-import company gap
-- (PROGRESS.md P2-7) — a labeled approximation, not a silent one.

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

  if exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and date = v_date and status != 'Rejected'
  ) then
    raise exception 'A leave application already exists for %', v_date;
  end if;

  select employment_status, joining_date into v_emp_status, v_joining_date from employees where id = p_emp_id;

  -- P4B-9 — probation/notice 1-leave cap. Work From Home, On Duty and LOP itself don't
  -- count against the cap — they aren't "leave taken" in the policy's sense (WFH/On
  -- Duty are still working; LOP is exactly the fallback the policy sends you to).
  if v_emp_status in ('Probation', 'Notice Period')
     and v_leave_type not in ('Unpaid Leave', 'Work From Home', 'On Duty') then
    v_fy_start := make_date(current_fy(), 4, 1);
    v_fy_end := make_date(current_fy() + 1, 3, 31);
    select count(*) into v_capped_leave_count from leave_applications
      where emp_id = p_emp_id and status != 'Rejected'
        and leave_type not in ('Unpaid Leave', 'Work From Home', 'On Duty')
        and date between v_fy_start and v_fy_end;
    if v_capped_leave_count >= 1 then
      raise exception 'Only 1 leave is allowed during your % — apply as Unpaid Leave (LOP) instead', v_emp_status;
    end if;
  end if;

  -- P4B-10 — Marriage and Maternity require 18 months of service.
  if v_leave_type in ('Marriage Leave', 'Maternity Leave')
     and (v_joining_date is null or v_joining_date > (current_date - interval '18 months')) then
    raise exception '% requires at least 18 months of service', v_leave_type;
  end if;

  if v_leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    v_needed := case when v_day_part = 'full' then 1 else 0.5 end;
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = v_leave_type and financial_year = current_fy();
    if v_balance is not null and v_balance < v_needed then
      raise exception 'Insufficient % balance — % remaining this year', v_leave_type, v_balance;
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;
