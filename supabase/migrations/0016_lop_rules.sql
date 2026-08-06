-- Day 3 midday — LOP rename, pre-approval rule, absence -> LOP report
-- (plan.md Day 3, PROGRESS.md P4B-11, P4B-12, P4B-13, P4B-14).
--
-- No real leave_applications data exists yet (verified live before writing this), so
-- renaming the stored leave_type string itself from 'Unpaid Leave' to 'LOP' is safe —
-- no data migration needed, and it matches the policy doc's own term exactly instead of
-- carrying two names for the same thing.

-- ============ employee_apply_leave — LOP rename + pre-approval-a-day-before (P4B-11, P4B-12) ============
-- Policy doc: "Leave must be pre-approved a day before." Applied to the planned,
-- vacation-style leave types only — Sick Leave and Bereavement Leave are, by their own
-- nature, unplannable (you don't know a day ahead that you'll be sick or bereaved), and
-- WFH/On Duty/LOP are operational-flexibility types rather than the vacation leave this
-- clause is clearly aimed at. A documented judgment call, not something the policy PDF
-- spells out explicitly — easy to narrow or widen later by editing this exclusion list.

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

  if v_leave_type not in ('Sick Leave', 'Bereavement Leave', 'Work From Home', 'On Duty', 'LOP')
     and v_date < current_date + 1 then
    raise exception '% must be applied at least a day in advance', v_leave_type;
  end if;

  if exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and date = v_date and status != 'Rejected'
  ) then
    raise exception 'A leave application already exists for %', v_date;
  end if;

  select employment_status, joining_date into v_emp_status, v_joining_date from employees where id = p_emp_id;

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

-- ============ admin_get_absence_lop_report — P4B-13, P4B-14 ============
-- Policy doc: "one absent will be treated as two days LOP" · "LOP will include all the
-- Week offs and/or all Public holidays which might come in between the LOP period."
--
-- Read as a spell of consecutive days bounded by the last actually-present (or
-- on-approved-leave) day on either side: every unapproved-absent WORKING day inside
-- that spell counts double, every week-off/holiday day caught inside it counts once
-- (it was never going to be a working day either way, so no doubling).
--
-- This is a REPORT for HR to review and act on, not an automatic deduction — the
-- policy doc itself puts sanctioning at "Management discretion," and nothing else in
-- this schema silently docks pay or balance without a human decision (same posture as
-- the EL-payout table in 0014, which records what's owed rather than paying it itself).
--
-- Documented limitation: this can only see days that have an attendance ROW. A day with
-- truly zero activity (no punch, no bio import run, no manual entry) never gets a row
-- at all in this schema — there's no "insert one row per employee per calendar day"
-- process — so it's invisible here too. In practice the daily biometric import (P3-10)
-- is what actually creates a row for every employee every working day, so this holds as
-- long as that import runs; if it's ever skipped for a stretch, this report will
-- under-count for exactly that stretch. Same honest-gap posture as the bio-import
-- company default (PROGRESS.md P2-7).

create or replace function public.admin_get_absence_lop_report(p_token uuid, p_from date, p_to date)
 returns table(
   emp_id uuid, emp_name text, run_start date, run_end date,
   absent_working_days integer, off_days_in_run integer, total_lop_days integer
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Every CTE column below is aliased away from the bare name "emp_id" (using
  -- v_emp_id) — this function's own OUT parameter is also called emp_id (matching
  -- every other admin_get_* function's column naming), and plpgsql resolves a bare
  -- "emp_id" reference inside the function body against that OUT parameter first,
  -- not the table column, which made the grouped/runs CTEs below raise "column
  -- reference emp_id is ambiguous" — caught by the live verification script for this
  -- migration, not by G-1 (a runtime ambiguity, not a missing-column reference).
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
  with days as (
    select a.emp_id as v_emp_id, a.date as v_date,
      (a.day_type = 'working' and a.status = 'Absent') as is_absent_working,
      (a.day_type in ('week_off', 'holiday')) as is_off_day
    from attendance a
    where a.date between p_from and p_to
  ),
  flagged as (
    select *,
      case when is_absent_working or is_off_day then 0 else 1 end as breaks_run
    from days
  ),
  grouped as (
    select *, sum(breaks_run) over (partition by v_emp_id order by v_date) as run_id
    from flagged
  ),
  runs as (
    select v_emp_id, run_id,
      min(v_date) as run_start, max(v_date) as run_end,
      count(*) filter (where is_absent_working) as absent_working_days,
      count(*) filter (where is_off_day) as off_days_in_run
    from grouped
    where is_absent_working or is_off_day
    group by v_emp_id, run_id
    having count(*) filter (where is_absent_working) > 0
  )
  select r.v_emp_id, e.name, r.run_start, r.run_end,
    r.absent_working_days::integer, r.off_days_in_run::integer,
    (r.absent_working_days * 2 + r.off_days_in_run)::integer as total_lop_days
  from runs r
  join employees e on e.id = r.v_emp_id
  order by e.name, r.run_start;
end;
$function$;

grant execute on function public.admin_get_absence_lop_report(uuid, date, date) to anon;
