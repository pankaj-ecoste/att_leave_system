-- plan.md §58 — apply for several days at once, wait for approval before applying again (same type), and never
-- let a balance be overdrawn.
--
-- Body of apply_leave_core is the LIVE employee_apply_leave (copied with pg_get_functiondef on 2026-11-02) plus:
--   * the "already waiting for approval" block (same type; LOP / Work From Home / On Duty exempt; requests whose
--     date has already passed do not block),
--   * the balance check now subtracts the days already waiting for approval (this is what closes the overdraw gap).
-- The core is private (no one can call it from the app); the two public functions only check the session token.

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
begin
  if v_day_part not in ('full', 'first_half', 'second_half') then
    raise exception 'Invalid day part';
  end if;
  if v_day_part != 'full' and v_leave_type not in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    raise exception 'Half-day is only available for Sick, Casual and Earned Leave';
  end if;

  if v_leave_type in ('Partial Leave - 1 Hour', 'Partial Leave - 2 Hours', 'Casual Leave', 'Earned Leave') and v_date < current_date then
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

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, document_path, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', nullif(p_data->>'document_path', ''), 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.apply_leave_core(uuid, jsonb, boolean) from public, anon, authenticated;

-- One day, exactly as before (kept so an old open tab still works), now through the core.
create or replace function public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return apply_leave_core(p_emp_id, p_data, true);
end;
$function$;

-- A range of days in one go: p_data.date = first day, p_data.end_date = last day (optional). Sundays and listed
-- holidays inside the range are skipped. All-or-nothing: any failing day cancels the whole application.
create or replace function public.employee_apply_leave_range(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns setof leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_from date := (p_data->>'date')::date;
  v_to date := coalesce(nullif(p_data->>'end_date', '')::date, (p_data->>'date')::date);
  v_day_part text := coalesce(nullif(p_data->>'day_part', ''), 'full');
  v_d date;
  v_first boolean := true;
  v_row leave_applications;
  v_n int;
  v_balance numeric;
  v_waiting numeric;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  if v_from is null then raise exception 'Please choose a date'; end if;
  if v_to < v_from then raise exception 'The last day cannot be before the first day'; end if;
  if v_to - v_from > 30 then raise exception 'A single application can cover at most 31 days'; end if;
  if v_day_part != 'full' and v_to != v_from then raise exception 'A half day can only be applied for a single date'; end if;

  if (p_data->>'leave_type') not in ('LOP', 'Work From Home', 'On Duty') and exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and leave_type = p_data->>'leave_type'
      and status in ('Pending', 'Manager Approved') and date >= current_date
  ) then
    raise exception 'You already have a % request waiting for approval — you can apply again once it is approved or rejected', p_data->>'leave_type';
  end if;

  -- say it plainly before anything is saved: the whole range must fit in the balance that is still free
  select count(*) into v_n from generate_series(v_from, v_to, interval '1 day') d
    where (v_from = v_to or (extract(dow from d) <> 0 and not exists (select 1 from holidays h where h.date = d::date)));
  if (p_data->>'leave_type') in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = p_data->>'leave_type' and financial_year = current_fy();
    select coalesce(sum(case when day_part = 'full' then 1 else 0.5 end), 0) into v_waiting from leave_applications
      where emp_id = p_emp_id and leave_type = p_data->>'leave_type' and status in ('Pending', 'Manager Approved');
    if v_balance is not null and v_balance - v_waiting < v_n * (case when v_day_part = 'full' then 1 else 0.5 end) then
      raise exception 'Not enough % balance — you asked for % day(s) but only % available. Please apply as LOP for the rest.',
        p_data->>'leave_type', v_n * (case when v_day_part = 'full' then 1 else 0.5 end), greatest(v_balance - v_waiting, 0);
    end if;
  end if;

  for v_d in
    select d::date from generate_series(v_from, v_to, interval '1 day') d
    where (v_from = v_to or (extract(dow from d) <> 0 and not exists (select 1 from holidays h where h.date = d::date)))
    order by d
  loop
    v_row := apply_leave_core(p_emp_id, p_data || jsonb_build_object('date', v_d::text), v_first);
    v_first := false;
    return next v_row;
  end loop;

  if v_first then raise exception 'All the chosen days are Sundays or holidays — nothing to apply for'; end if;
  return;
end;
$function$;

revoke all on function public.employee_apply_leave_range(uuid, uuid, jsonb) from public;
grant execute on function public.employee_apply_leave_range(uuid, uuid, jsonb) to anon, authenticated;
