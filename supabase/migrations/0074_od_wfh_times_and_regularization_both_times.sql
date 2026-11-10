-- 0074 (plan.md §60): On Duty / Work From Home requests carry an in-time and an out-time (today only), the times are
-- written into attendance when a manager/admin APPROVES; Regularization needs both times.
--
-- Built from the LIVE function bodies (0072 for the apply functions, 0042 for the approval effects, 0059 for
-- regularization) — the apply script proves live == those files before it changes anything.
-- The decide functions (manager_decide_leave / admin_decide_leave) and every list function are NOT touched:
-- they `select *`, so the two new columns flow through to the screens by themselves.

alter table public.leave_applications
  add column if not exists requested_in time without time zone,
  add column if not exists requested_out time without time zone;

-- ============ apply_leave_core: today-only + both times for On Duty / Work From Home ============

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

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, document_path, status, requested_in, requested_out)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', nullif(p_data->>'document_path', ''), 'Pending', v_req_in, v_req_out)
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.apply_leave_core(uuid, jsonb, boolean) from public, anon, authenticated;

-- ============ employee_apply_leave_range: On Duty / WFH are one day only (clear message before the core runs) ============

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
  if (p_data->>'leave_type') in ('Work From Home', 'On Duty') and v_to != v_from then
    raise exception '% can only be applied for today, one day at a time', p_data->>'leave_type';
  end if;

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

-- ============ apply_leave_approval_effects: approved On Duty / WFH writes its in/out time ============

create or replace function public.apply_leave_approval_effects(p_row leave_applications)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_deduct numeric;
  v_status text;
  v_existing attendance;
  v_std_hours numeric;
  v_raw_hours numeric;
  v_partial_credit numeric;
  v_in time;
  v_out time;
begin
  if p_row.leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave', 'Compensatory Leave') then
    v_deduct := case when p_row.day_part = 'full' then 1 else 0.5 end;
    update leave_balances set consumed = consumed + v_deduct, balance = balance - v_deduct, updated_at = now()
      where emp_id = p_row.emp_id and leave_type = p_row.leave_type and financial_year = current_fy();
  end if;

  select * into v_existing from attendance where emp_id = p_row.emp_id and date = p_row.date;

  if p_row.day_part != 'full' then
    v_status := 'Half Day Leave';
  elsif p_row.leave_type = 'Work From Home' then
    v_status := 'WFH';
  elsif p_row.leave_type = 'On Duty' then
    v_status := 'On Duty';
  elsif p_row.leave_type in ('Partial Leave - 1 Hour', 'Partial Leave - 2 Hours') then
    -- Partial Leave still requires punching in/out that day (LEAVE_TYPES has
    -- present: true for these — src/lib/constants.js) — status depends on hours
    -- actually worked, credited by the leave's excused hours, same grace-period +
    -- half-day-threshold rule calcStatus uses. If the day hasn't been punched yet
    -- (leave approved in advance), leave status alone — employee_punch computes and
    -- stores the correct value itself once they actually punch.
    if v_existing.in_time is not null and v_existing.out_time is not null then
      select coalesce(e.std_hours_override, s.std_hours) into v_std_hours
        from employees e cross join app_settings s where e.id = p_row.emp_id;
      v_raw_hours := extract(epoch from (
        case when v_existing.out_time < v_existing.in_time
          then v_existing.out_time + interval '24 hours' - v_existing.in_time
          else v_existing.out_time - v_existing.in_time
        end
      )) / 3600.0;
      v_partial_credit := case when p_row.leave_type = 'Partial Leave - 1 Hour' then 1 else 2 end;
      v_status := case
        when greatest(0, v_std_hours - v_raw_hours - v_partial_credit) <= 0.25 then 'Present'
        when (v_raw_hours + v_partial_credit) < v_std_hours / 2 then 'Absent'
        else 'Half Day'
      end;
    else
      v_status := v_existing.status; -- not punched yet — nothing to recompute, leave as-is (likely null)
    end if;
  else
    v_status := 'Leave';
  end if;

  -- plan.md §60 — an approved On Duty / WFH day carries the in/out time the person asked for, so its hours count.
  -- Rows approved before this change have no times and behave exactly as before. If the person had already punched
  -- that day, the approved times replace the punch times (their real punches stay in app_in_time / app_out_time)
  -- and the replacement is written to the audit log.
  if p_row.leave_type in ('Work From Home', 'On Duty') and p_row.day_part = 'full'
     and p_row.requested_in is not null and p_row.requested_out is not null then
    v_in := p_row.requested_in;
    v_out := p_row.requested_out;
    if (v_existing.in_time is not null and v_existing.in_time is distinct from v_in)
       or (v_existing.out_time is not null and v_existing.out_time is distinct from v_out) then
      perform log_audit('LEAVE_TIMES_REPLACED',
        format('%s %s on %s: punch times %s–%s replaced by approved times %s–%s',
          p_row.emp_name, p_row.leave_type, p_row.date,
          coalesce(to_char(v_existing.in_time, 'HH24:MI'), '--'), coalesce(to_char(v_existing.out_time, 'HH24:MI'), '--'),
          to_char(v_in, 'HH24:MI'), to_char(v_out, 'HH24:MI')), 'system');
    end if;
  end if;

  -- Only the leave-related columns (plus the approved times, when there are any) are written — an existing punch or
  -- biometric import row for the same date survives untouched, same as before.
  insert into attendance (emp_id, date, leave_type, leave_reason, day_part, status, wfh, on_duty, in_time, out_time)
  values (p_row.emp_id, p_row.date, p_row.leave_type, p_row.reason, p_row.day_part, v_status,
    p_row.leave_type = 'Work From Home', p_row.leave_type = 'On Duty', v_in, v_out)
  on conflict (emp_id, date) do update set
    leave_type = excluded.leave_type, leave_reason = excluded.leave_reason,
    day_part = excluded.day_part, status = coalesce(excluded.status, attendance.status),
    wfh = excluded.wfh, on_duty = excluded.on_duty,
    in_time = coalesce(excluded.in_time, attendance.in_time),
    out_time = coalesce(excluded.out_time, attendance.out_time),
    updated_at = now();
end;
$function$;

revoke execute on function public.apply_leave_approval_effects(leave_applications) from public, anon, authenticated;

-- ============ employee_submit_regularization: both times required ============

create or replace function public.employee_submit_regularization(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_monthly_limit constant int := 5;
  v_row regularization_requests;
  v_used int;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  -- plan.md §60 — a correction must say BOTH times (checked before it can use up one of the 5 monthly requests).
  if p_in is null or p_out is null then
    raise exception 'Please enter both your in-time and your out-time';
  end if;

  perform pg_advisory_xact_lock(hashtext('regularization_quota:' || p_emp_id::text));

  select count(*) into v_used
    from regularization_requests
    where emp_id = p_emp_id
      and (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata');

  if v_used >= c_monthly_limit then
    raise exception 'You have already used all % attendance correction requests for this month. The limit resets on the 1st. Please contact HR if you need more.', c_monthly_limit;
  end if;

  insert into regularization_requests(emp_id, date, requested_in, requested_out, reason)
  values(p_emp_id, p_date, p_in, p_out, p_reason) returning * into v_row;
  return v_row;
end;$function$;
