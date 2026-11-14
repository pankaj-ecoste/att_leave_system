-- plan.md §62 — Casual / Earned / Sick Leave can be applied for a PAST day, but only inside the current calendar
-- month, and never for a day that already has a punch (that is what Regularization is for).
--
-- Body of apply_leave_core is the LIVE one (== migration 0074 — On Duty / WFH time rules included; proved by the
-- apply script before it changes anything) with ONE block replaced — the "past date" block:
--   * Partial Leave: still same-day / future only (unchanged).
--   * Casual / Earned / Sick: past days allowed from the 1st of the current month (IST) up to yesterday; an earlier
--     month is refused; a past day that has any punch is refused. Today and future days behave exactly as before.
--     (Sick Leave used to have no past-date limit at all — it is now limited to the current month too.)
--   * Every other type: unchanged ("must be applied at least a day in advance" for the ones that have it).
-- Nothing else in the function changes; employee_apply_leave_range and the approval functions are not touched.

create or replace function public.apply_leave_core(p_emp_id uuid, p_data jsonb, p_check_waiting boolean)
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
  v_waiting numeric;
  v_emp_status text;
  v_joining_date date;
  v_company text;
  v_capped_leave_count int;
  v_fy_start date;
  v_fy_end date;
  v_req_in time;
  v_req_out time;
  v_today_ist date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_day_part not in ('full', 'first_half', 'second_half') then
    raise exception 'Invalid day part';
  end if;
  if v_day_part != 'full' and v_leave_type not in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    raise exception 'Half-day is only available for Sick, Casual and Earned Leave';
  end if;

  -- plan.md §60 — On Duty / Work From Home: today only, with the in-time and out-time the person will work.
  -- Enforced here (not just on the screen) so an old or tampered app cannot skip it.
  if v_leave_type in ('Work From Home', 'On Duty') then
    if v_date is distinct from (now() at time zone 'Asia/Kolkata')::date then
      raise exception '% can only be applied for today', v_leave_type;
    end if;
    v_req_in := nullif(p_data->>'requested_in', '')::time;
    v_req_out := nullif(p_data->>'requested_out', '')::time;
    if v_req_in is null or v_req_out is null then
      raise exception 'Please enter your in-time and out-time for %', v_leave_type;
    end if;
    if v_req_out <= v_req_in then
      raise exception 'Out-time must be after in-time';
    end if;
  end if;

  if v_leave_type in ('Partial Leave - 1 Hour', 'Partial Leave - 2 Hours') and v_date < current_date then
    raise exception '% cannot be applied for a past date', v_leave_type;
  elsif v_leave_type in ('Casual Leave', 'Earned Leave', 'Sick Leave') then
    -- plan.md §62 — a past day is allowed only inside the current month, and only if nothing was punched that day
    if v_date < v_today_ist then
      if v_date < date_trunc('month', v_today_ist)::date then
        raise exception 'Leave can only be applied for dates within the current month';
      end if;
      if exists (
        select 1 from attendance
        where emp_id = p_emp_id and date = v_date
          and (in_time is not null or out_time is not null or app_in_time is not null or app_out_time is not null)
      ) then
        raise exception 'You have attendance for % — leave cannot be applied for a day you worked. Use Regularization to correct it instead.', v_date;
      end if;
    end if;
  elsif v_leave_type not in ('Bereavement Leave', 'Work From Home', 'On Duty', 'LOP',
                             'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours')
        and v_date < current_date + 1 then
    raise exception '% must be applied at least a day in advance', v_leave_type;
  end if;

  if exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and date = v_date and status != 'Rejected'
  ) then
    raise exception 'A leave application already exists for %', v_date;
  end if;

  -- plan.md §58 — one set of requests of a type at a time (LOP / Work From Home / On Duty are exempt).
  if p_check_waiting and v_leave_type not in ('LOP', 'Work From Home', 'On Duty') and exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and leave_type = v_leave_type
      and status in ('Pending', 'Manager Approved') and date >= current_date
  ) then
    raise exception 'You already have a % request waiting for approval — you can apply again once it is approved or rejected', v_leave_type;
  end if;

  select employment_status, joining_date, company into v_emp_status, v_joining_date, v_company from employees where id = p_emp_id;

  -- V2 decision 3 (plan.md §11) — 8 leave types are off-limits for Production Plant employees.
  if v_company = 'Asma + Production Plant'
     and v_leave_type in ('Bereavement Leave', 'Marriage Leave', 'Maternity Leave', 'Paternity Leave',
                           'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Work From Home', 'On Duty') then
    raise exception '% is not available for Production Plant employees', v_leave_type;
  end if;

  -- plan.md §23 — probation / notice period: only 1 leave per year (LOP, WFH, On Duty, Partial exempt).
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
    -- plan.md §58 — days already waiting for approval (earlier requests, and earlier days of this same range) are
    -- not deducted yet but are already spoken for.
    select coalesce(sum(case when day_part = 'full' then 1 else 0.5 end), 0) into v_waiting
      from leave_applications
      where emp_id = p_emp_id and leave_type = v_leave_type and status in ('Pending', 'Manager Approved');
    if v_balance is not null and v_balance - v_waiting < v_needed then
      raise exception 'Not enough % balance — % available (% already waiting for approval). Please apply as LOP for the rest.',
        v_leave_type, greatest(v_balance - v_waiting, 0), v_waiting;
    end if;
    if v_leave_type = 'Compensatory Leave' and v_balance is null then
      raise exception 'No Compensatory Leave balance — none earned yet';
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, document_path, status, requested_in, requested_out)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', nullif(p_data->>'document_path', ''), 'Pending', v_req_in, v_req_out)
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.apply_leave_core(uuid, jsonb, boolean) from public, anon, authenticated;
