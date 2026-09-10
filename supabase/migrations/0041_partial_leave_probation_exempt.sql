-- HR request (2026-09-10): Partial Leave - 1 Hour / 2 Hours must not be capped by the
-- Probation/Notice-Period "only 1 leave per year" rule. employee_apply_leave has always
-- (since 0016) capped Probation/Notice-Period employees to 1 leave per financial year
-- across every leave type except LOP/Work From Home/On Duty. Partial Leave was never
-- added to that exemption list (0031 and 0040 only exempted it from the same-day and
-- advance-notice rules, not this probation cap), so a Probation/Notice-Period employee
-- who'd already used their 1 confirmed-type leave this year got blocked from partial
-- leave too, with "Only 1 leave is allowed during your Probation — apply as LOP
-- instead" — even though policy makes 1hr/2hr short leave available to everyone,
-- Confirmed or Probation/Notice Period alike.
--
-- Fix: add Partial Leave - 1 Hour / 2 Hours to both places in the probation-cap block —
-- the trigger condition and the count query — same treatment LOP/WFH/On Duty already
-- get. Partial leave applications will neither trigger the cap themselves nor count
-- against it for other leave types. The existing monthly cap (2x1hr, 1x2hr, enforced
-- client-side) is untouched and still applies to everyone. Every other rule in this
-- function (same-day rules, half-day eligibility, 18-month service check, balance
-- check, Plant restriction, duplicate-application check) is untouched — see plan.md §23.

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
  elsif v_leave_type in ('Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Casual Leave') and v_date < current_date then
    raise exception '% cannot be applied for a past date', v_leave_type;
  elsif v_leave_type not in ('Sick Leave', 'Bereavement Leave', 'Work From Home', 'On Duty', 'LOP', 'Earned Leave',
                             'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Casual Leave')
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

  -- plan.md §23 — Partial Leave (1hr/2hr) is exempt from the probation/notice-period
  -- yearly "1 leave" cap, same as LOP/WFH/On Duty: available to everyone regardless of
  -- employment status, capped only by its own monthly limit (enforced client-side).
  if v_emp_status in ('Probation', 'Notice Period')
     and v_leave_type not in ('LOP', 'Work From Home', 'On Duty', 'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours') then
    v_fy_start := make_date(current_fy(), 4, 1);
    v_fy_end := make_date(current_fy() + 1, 3, 31);
    select count(*) into v_capped_leave_count from leave_applications
      where emp_id = p_emp_id and status != 'Rejected'
        and leave_type not in ('LOP', 'Work From Home', 'On Duty', 'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours')
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

  if v_leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave', 'Compensatory Leave') then
    v_needed := case when v_day_part = 'full' then 1 else 0.5 end;
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = v_leave_type and financial_year = current_fy();
    if v_balance is not null and v_balance < v_needed then
      raise exception 'Insufficient % balance — % remaining this year', v_leave_type, v_balance;
    end if;
    if v_leave_type = 'Compensatory Leave' and v_balance is null then
      raise exception 'No Compensatory Leave balance — none earned yet';
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, document_path, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', nullif(p_data->>'document_path', ''), 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;
