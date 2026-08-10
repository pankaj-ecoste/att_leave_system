-- V2 Phase C (plan.md §11 decisions 5-15, PROGRESS.md VC-1..VC-8): monthly CL/EL
-- accrual ledger + Compensatory Leave (comp-off).
--
-- Two decisions confirmed with the user before writing this (this is the one part of
-- V2 that touches real, live leave balances for 131 people, unlike the purely-additive
-- Phases A/B):
--   1. GRANDFATHER existing balances — nobody's current CL/EL balance is reduced or
--      reset. Monthly credits only add on top, capped at the annual quota, starting
--      from the next monthly cron run.
--   2. Comp-off crediting is fully automatic (a daily job), no manual admin approval
--      step — same posture as this app's other tracking-only automation (OT, location
--      logs).
--
-- Grandfathering is safe by construction, not just by promise: every one of the 131
-- employees' current-FY leave_balances rows already has accrued = quota (the original
-- seed gave everyone the full annual amount up front, and the later HR
-- balance-correction script — scripts/apply-leave-balance-corrections.mjs —
-- deliberately left accrued/quota untouched, only correcting balance/consumed). The
-- monthly accrual job below only credits rows where accrued < quota, so it naturally
-- skips every current employee until their *next* annual rollover (1 April 2027),
-- when their new-FY row starts at 0 and monthly crediting takes over cleanly. No
-- per-employee grandfathering logic is needed — the existing data shape guarantees it.

-- ============ 1. leave_accruals — the ledger (VC-1) ============
-- One row per CREDIT event (monthly CL/EL credit, comp-off day-worked credit, comp-off
-- month-end expiry). Day-to-day leave *consumption* keeps being tracked the existing
-- way (leave_balances.consumed, updated by admin_decide_leave) — duplicating every
-- leave approval into this ledger too would be a much bigger change than the "ledger
-- table" decision asked for, and nothing in plan.md §11 requests it.

create table if not exists "public"."leave_accruals" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "leave_type" text not null,
  "period" date not null,
  "credited" numeric not null default 0,
  "used" numeric not null default 0,
  "running_balance" numeric not null default 0,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  unique (emp_id, leave_type, period)
);
create index if not exists idx_leave_accruals_emp on leave_accruals (emp_id);
alter table leave_accruals enable row level security;

-- ============ 2. comp_off_payouts — month-end expiry record (VC-8) ============
-- Deliberately a SEPARATE table from the existing leave_payouts (used only for the
-- annual EL payout, unique on emp/type/financial_year). Comp-off expires monthly, not
-- annually, so reusing leave_payouts would mean widening its unique constraint and
-- touching an already-shipped, already-verified function (run_annual_leave_rollover)
-- for no real benefit. This keeps Phase C purely additive to that path.

create table if not exists "public"."comp_off_payouts" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "period" date not null,
  "days_lapsed" numeric not null default 0,
  "created_at" timestamp with time zone default now() not null,
  unique (emp_id, period)
);
create index if not exists idx_comp_off_payouts_period on comp_off_payouts (period);
alter table comp_off_payouts enable row level security;

-- ============ 3. run_monthly_leave_accrual — CL +1 / EL +0.5 each month (VC-2) ============
-- Only credits rows where accrued < quota, which is what makes grandfathering automatic
-- (see header note) — every current employee is already at accrued = quota and gets
-- skipped until their FY row resets to 0 at the next annual rollover.

create or replace function public.run_monthly_leave_accrual()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_period date := date_trunc('month', current_date)::date;
  v_count int := 0;
  v_rec record;
  v_credit numeric;
  v_new_accrued numeric;
  v_new_balance numeric;
begin
  for v_rec in
    select lb.id, lb.emp_id, lb.leave_type, lb.accrued, lb.balance, lb.quota
    from leave_balances lb
    join employees e on e.id = lb.emp_id
    where lb.financial_year = current_fy()
      and lb.leave_type in ('Casual Leave', 'Earned Leave')
      and lb.accrued < lb.quota
      and e.deleted_at is null and e.active
  loop
    continue when exists (
      select 1 from leave_accruals
      where emp_id = v_rec.emp_id and leave_type = v_rec.leave_type and period = v_period
    );

    v_credit := case v_rec.leave_type when 'Casual Leave' then 1 when 'Earned Leave' then 0.5 end;
    v_new_accrued := least(v_rec.accrued + v_credit, v_rec.quota);
    v_new_balance := v_rec.balance + (v_new_accrued - v_rec.accrued);

    update leave_balances set accrued = v_new_accrued, balance = v_new_balance
      where id = v_rec.id;

    insert into leave_accruals (emp_id, leave_type, period, credited, running_balance, note)
    values (v_rec.emp_id, v_rec.leave_type, v_period, v_new_accrued - v_rec.accrued, v_new_balance, 'monthly_credit')
    on conflict (emp_id, leave_type, period) do nothing;
    v_count := v_count + 1;
  end loop;

  perform log_audit('LEAVE_MONTHLY_ACCRUAL', v_period || ': ' || v_count || ' balance rows credited', 'system');
  return v_count;
end;
$function$;

-- 01:30 UTC on the 1st of every month (~07:00 IST) — 30 minutes after the existing
-- annual-rollover slot (0 1 1 4 *) so ordering on 1 April is deterministic: rollover
-- creates the fresh FY row first (accrued=0 for CL/EL, see #4 below), then this job
-- gives it month one's credit the same morning.
select cron.schedule(
  'monthly-leave-accrual',
  '30 1 1 * *',
  $$ select run_monthly_leave_accrual(); $$
);

revoke execute on function public.run_monthly_leave_accrual() from public, anon, authenticated;

-- ============ 4. run_annual_leave_rollover — CL/EL new-FY rows start at 0 (VC-4) ============
-- Only the crediting CADENCE changes (decision 6, plan.md §11) — the EL-payout-cap-at-3
-- logic just above this insert is untouched, and every other leave type (Sick Leave —
-- decision 7 — and anything else with a balance row) keeps the existing
-- full-quota-on-day-one behavior. This is only reachable from the next 1 April (2027),
-- so there's zero transition risk to today's live data.

create or replace function public.run_annual_leave_rollover(p_new_fy integer default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_new_fy int := coalesce(p_new_fy, current_fy());
  v_closing_fy int := v_new_fy - 1;
  v_count int;
  v_payout_count int;
begin
  insert into leave_payouts (emp_id, leave_type, financial_year, days_paid, days_lapsed)
  select emp_id, leave_type, v_closing_fy, least(balance, 3), greatest(balance - 3, 0)
  from leave_balances
  where financial_year = v_closing_fy and leave_type = 'Earned Leave' and balance > 0
  on conflict (emp_id, leave_type, financial_year) do nothing;
  get diagnostics v_payout_count = row_count;

  insert into leave_balances(emp_id, leave_type, accrued, consumed, balance, quota, unit, financial_year)
  select emp_id, leave_type,
    case when leave_type in ('Casual Leave', 'Earned Leave') then 0 else quota end,
    0,
    case when leave_type in ('Casual Leave', 'Earned Leave') then 0 else quota end,
    quota, unit, v_new_fy
  from leave_balances
  where financial_year = v_closing_fy
  on conflict (emp_id, leave_type, financial_year) do nothing;
  get diagnostics v_count = row_count;

  perform log_audit('LEAVE_ANNUAL_ROLLOVER',
    'FY ' || v_closing_fy || ' -> ' || v_new_fy || ': ' || v_count || ' balance rows created, ' || v_payout_count || ' EL payout rows recorded',
    'system');
  return v_count;
end;
$function$;

revoke execute on function public.run_annual_leave_rollover(integer) from public, anon, authenticated;

-- ============ 5. admin_create_employee — new hire gets only the joining month's credit (VC-5) ============
-- quota still holds the full pro-rated entitlement for the year (unchanged concept,
-- same months_remaining_in_fy() formula) — it's just the up-front CREDIT that now
-- matches the monthly model: only this month's share lands immediately, and
-- run_monthly_leave_accrual carries the new hire the rest of the way in step with
-- everyone else. A leave_accruals row is inserted for this initial credit too, so the
-- ledger has no gap at hire time.

create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_row employees; v_joining_date date; v_months numeric;
  v_cl_quota numeric; v_el_quota numeric; v_cl_initial numeric; v_el_initial numeric;
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
  v_cl_quota := least(12, v_months);
  v_el_quota := least(6, v_months * 0.5);
  v_cl_initial := case when v_joining_date is null or extract(day from v_joining_date) <= 15 then least(1, v_cl_quota) else 0 end;
  v_el_initial := case when v_joining_date is null or extract(day from v_joining_date) <= 15 then least(0.5, v_el_quota) else 0 end;

  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values
    (v_row.id, 'Casual Leave', v_cl_initial, 0, v_cl_initial, v_cl_quota, 'Days'),
    (v_row.id, 'Earned Leave', v_el_initial, 0, v_el_initial, v_el_quota, 'Days'),
    (v_row.id, 'Sick Leave', 4, 0, 4, 4, 'Days')
  on conflict (emp_id, leave_type, financial_year) do nothing;

  if v_cl_initial > 0 then
    insert into leave_accruals (emp_id, leave_type, period, credited, running_balance, note)
    values (v_row.id, 'Casual Leave', date_trunc('month', current_date)::date, v_cl_initial, v_cl_initial, 'hire_initial_credit')
    on conflict (emp_id, leave_type, period) do nothing;
  end if;
  if v_el_initial > 0 then
    insert into leave_accruals (emp_id, leave_type, period, credited, running_balance, note)
    values (v_row.id, 'Earned Leave', date_trunc('month', current_date)::date, v_el_initial, v_el_initial, 'hire_initial_credit')
    on conflict (emp_id, leave_type, period) do nothing;
  end if;

  perform log_audit('EMPLOYEE_CREATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;
$function$;

-- ============ 6. employee_apply_leave — Compensatory Leave joins the balance-checked types (VC-3, VC-7) ============
-- Everything else about this function already applies uniformly with no further
-- changes: Compensatory Leave isn't in the Plant-restricted list (decision 9 — Plant
-- employees can use it), isn't in the pre-approval-exempt list so it inherits the same
-- 1-day-advance rule Casual Leave already has, and isn't exempted from the
-- probation/notice cap so it counts the same way Casual Leave does — matching "applied
-- exactly like Casual Leave" (decision 11) with no special-casing needed.

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

-- ============ 7. admin_decide_leave — deduct Compensatory Leave balance too (real gap) ============
-- Without this, an approved comp-off application would never actually deduct the
-- balance — the deduction check was hardcoded to the original 3 quota-tracked types
-- (Sick/Casual/Earned) and Compensatory Leave, being new, was silently excluded.

create or replace function public.admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_manager_emp_id uuid;
  v_deduct numeric;
  v_status text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;

  select * into v_row from leave_applications where id = p_leave_id;
  if not found then raise exception 'Leave application not found'; end if;
  if v_row.admin_decision is not null then raise exception 'Already decided'; end if;

  select manager_emp_id into v_manager_emp_id from employees where id = v_row.emp_id;

  if v_manager_emp_id is not null and v_row.manager_decision is distinct from 'Approved' then
    raise exception 'Waiting on manager approval first';
  end if;

  update leave_applications set
    admin_decision = p_decision,
    admin_decided_at = now(),
    status = p_decision,
    updated_at = now()
  where id = p_leave_id
  returning * into v_row;

  if p_decision = 'Approved' then
    if v_row.leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave', 'Compensatory Leave') then
      v_deduct := case when v_row.day_part = 'full' then 1 else 0.5 end;
      update leave_balances set consumed = consumed + v_deduct, balance = balance - v_deduct, updated_at = now()
        where emp_id = v_row.emp_id and leave_type = v_row.leave_type and financial_year = current_fy();
    end if;

    v_status := case
      when v_row.day_part != 'full' then 'Half Day Leave'
      when v_row.leave_type = 'Work From Home' then 'WFH'
      when v_row.leave_type = 'On Duty' then 'On Duty'
      else 'Leave'
    end;

    -- Only the leave-related columns are written — an existing punch or biometric
    -- import row for the same date (e.g. someone who worked the other half of a
    -- half-day) survives untouched.
    insert into attendance (emp_id, date, leave_type, leave_reason, day_part, status, wfh, on_duty)
    values (v_row.emp_id, v_row.date, v_row.leave_type, v_row.reason, v_row.day_part, v_status,
      v_row.leave_type = 'Work From Home', v_row.leave_type = 'On Duty')
    on conflict (emp_id, date) do update set
      leave_type = excluded.leave_type, leave_reason = excluded.leave_reason,
      day_part = excluded.day_part, status = excluded.status,
      wfh = excluded.wfh, on_duty = excluded.on_duty, updated_at = now();
  end if;

  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> admin ' || p_decision, 'admin');
  return v_row;
end;
$function$;

-- ============ 8. run_comp_off_accrual — daily automatic crediting (VC-6) ============
-- Deliberately checks the date against day-of-week + the holidays table directly,
-- rather than trusting attendance.day_type — that column only ever gets set to
-- 'week_off'/'holiday' by biometric imports or a manual admin edit, never
-- automatically at app-punch time (employee_punch takes whatever day_type the client
-- sends, defaulting to 'working' — confirmed by reading 0009_app_vs_biometric.sql).
-- Date + holidays is the reliable signal for "was this actually a Sunday or holiday."
-- Scans a trailing 7-day window (not just yesterday) to catch attendance rows that
-- land a day or two late via correction/bio-import.

create or replace function public.run_comp_off_accrual()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_std_hours numeric;
  v_count int := 0;
  v_rec record;
  v_hours numeric;
  v_new_balance numeric;
begin
  select std_hours into v_std_hours from app_settings where id = 1;

  for v_rec in
    select a.emp_id, a.date, a.in_time, a.out_time
    from attendance a
    join employees e on e.id = a.emp_id
    where a.date >= current_date - interval '7 days' and a.date < current_date
      and a.in_time is not null and a.out_time is not null
      and e.deleted_at is null and e.active
      and (extract(dow from a.date) = 0 or exists (select 1 from holidays h where h.date = a.date))
      and not exists (
        select 1 from leave_accruals la
        where la.emp_id = a.emp_id and la.leave_type = 'Compensatory Leave' and la.period = a.date
      )
  loop
    v_hours := extract(epoch from (
      case when v_rec.out_time < v_rec.in_time
        then v_rec.out_time + interval '24 hours' - v_rec.in_time
        else v_rec.out_time - v_rec.in_time
      end
    )) / 3600.0;

    if v_hours >= v_std_hours then
      insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
      values (v_rec.emp_id, 'Compensatory Leave', 0, 0, 0, 0, 'Days')
      on conflict (emp_id, leave_type, financial_year) do nothing;

      update leave_balances set accrued = accrued + 1, balance = balance + 1
        where emp_id = v_rec.emp_id and leave_type = 'Compensatory Leave' and financial_year = current_fy()
        returning balance into v_new_balance;

      insert into leave_accruals (emp_id, leave_type, period, credited, running_balance, note)
      values (v_rec.emp_id, 'Compensatory Leave', v_rec.date, 1, v_new_balance, 'worked_day_credit')
      on conflict (emp_id, leave_type, period) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  perform log_audit('COMP_OFF_ACCRUAL', v_count || ' comp-off credits', 'system');
  return v_count;
end;
$function$;

-- 20:00 UTC daily (~01:30 IST next day) — same off-peak slot pattern as the existing
-- location-log cleanup job.
select cron.schedule(
  'comp-off-daily-accrual',
  '0 20 * * *',
  $$ select run_comp_off_accrual(); $$
);

revoke execute on function public.run_comp_off_accrual() from public, anon, authenticated;

-- ============ 9. run_comp_off_expiry — month-end use-it-or-lose-it (VC-8) ============
-- "The system records it, HR still does the actual payroll entry manually" (decision
-- 12) — same posture as the existing EL payout table, just its own dedicated table.

create or replace function public.run_comp_off_expiry()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_closing_period date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_count int := 0;
  v_rec record;
begin
  for v_rec in
    select id, emp_id, balance from leave_balances
    where leave_type = 'Compensatory Leave' and financial_year = current_fy() and balance > 0
  loop
    insert into comp_off_payouts (emp_id, period, days_lapsed)
    values (v_rec.emp_id, v_closing_period, v_rec.balance)
    on conflict (emp_id, period) do nothing;

    insert into leave_accruals (emp_id, leave_type, period, used, running_balance, note)
    values (v_rec.emp_id, 'Compensatory Leave', v_closing_period, v_rec.balance, 0, 'month_end_expiry_payout')
    on conflict (emp_id, leave_type, period) do nothing;

    update leave_balances set accrued = 0, balance = 0 where id = v_rec.id;
    v_count := v_count + 1;
  end loop;

  perform log_audit('COMP_OFF_EXPIRY', v_closing_period || ': ' || v_count || ' comp-off balances expired to payout', 'system');
  return v_count;
end;
$function$;

-- 01:45 UTC on the 1st of every month — same batch window as the monthly CL/EL accrual
-- job, after it so both jobs run back-to-back rather than interleaved with anything else.
select cron.schedule(
  'comp-off-monthly-expiry',
  '45 1 1 * *',
  $$ select run_comp_off_expiry(); $$
);

revoke execute on function public.run_comp_off_expiry() from public, anon, authenticated;

-- ============ 10. HR visibility RPCs ============

create or replace function public.admin_get_leave_accruals(
  p_token uuid, p_emp_id uuid default null, p_leave_type text default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns table(
   id uuid, emp_id uuid, emp_name text, emp_num text, leave_type text, period date,
   credited numeric, used numeric, running_balance numeric, note text, created_at timestamp with time zone
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select la.id, la.emp_id, e.name, e.emp_num, la.leave_type, la.period, la.credited, la.used, la.running_balance, la.note, la.created_at
    from leave_accruals la
    join employees e on e.id = la.emp_id
    where (p_emp_id is null or la.emp_id = p_emp_id)
      and (p_leave_type is null or la.leave_type = p_leave_type)
    order by la.period desc, la.created_at desc
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_get_leave_accruals(uuid, uuid, text, integer, integer) to anon;

create or replace function public.admin_get_comp_off_payouts(p_token uuid, p_period date default null)
 returns table(
   id uuid, emp_id uuid, emp_name text, emp_num text, period date, days_lapsed numeric, created_at timestamp with time zone
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select cop.id, cop.emp_id, e.name, e.emp_num, cop.period, cop.days_lapsed, cop.created_at
    from comp_off_payouts cop
    join employees e on e.id = cop.emp_id
    where p_period is null or cop.period = p_period
    order by cop.period desc, e.name;
end;
$function$;

grant execute on function public.admin_get_comp_off_payouts(uuid, date) to anon;
