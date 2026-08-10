-- V2 Phase C follow-up #2 (2026-08-10, same day, more live feedback): `0025` computed
-- "months elapsed" as INCLUDING the current, still-in-progress month — meaning an
-- employee got August's credit the moment August started, not once August actually
-- finished. The user clarified the intended model is accrual IN ARREARS: a month's
-- credit only lands once that month is fully over, on the 1st of the following month —
-- so during August, someone who joined in July should show only July's credit (0.5 EL),
-- and only once September starts does August's 0.5 get added (bringing the running
-- total to 1). `run_monthly_leave_accrual()` (0024) already behaves this way mechanically
-- — it only fires once a month, on the 1st — the bug was entirely in how the "how much
-- should this employee already have as of today" starting point was computed, in two
-- places:
--
--   1. `months_elapsed_in_fy()` (0025) counted the current month towards the total
--      (a `+1` in the month-difference formula) — removed here, so only months strictly
--      BEFORE the current one count as "completed."
--   2. `admin_create_employee` (0024) credited 1 CL/0.5 EL immediately at hire if joined
--      on/before the 15th — an advance credit for a month that hasn't happened yet.
--      Removed: a new hire now always starts at accrued/balance = 0 for CL/EL, same as
--      everyone else's "no credit until a month completes" rule. The ≤15th cutoff still
--      matters for `quota` (their total prorated entitlement — unchanged) and for which
--      month becomes their `months_elapsed_in_fy` starting point; it just no longer pays
--      out anything the day they're hired.
--
-- This migration re-runs the same style of one-time correction 0025 did, using the
-- fixed formula — every current-FY CL/EL row drops by exactly one more month's worth
-- (1 CL / 0.5 EL) than 0025 left it at. Confirmed via a read-only dry run before writing
-- anything: all 276 rows reduced again, same 105 already-negative rows (expected —
-- see 0025's header for why negative is intentional, not a bug).

create or replace function public.months_elapsed_in_fy(p_joining_date date)
 returns numeric
 language plpgsql
 stable
as $function$
declare
  v_fy_start date := make_date(current_fy(), 4, 1);
  v_effective_start date;
  v_elapsed int;
begin
  if p_joining_date is null or p_joining_date <= v_fy_start then
    v_effective_start := v_fy_start;
  else
    v_effective_start := case when extract(day from p_joining_date) <= 15
      then p_joining_date
      else (date_trunc('month', p_joining_date) + interval '1 month')::date
    end;
  end if;
  -- No "+1" — only whole months strictly before the current one are "completed." A
  -- v_effective_start in the current month (or, in theory, later) naturally yields a
  -- month-diff of 0 or negative here, and greatest(0, ...) below floors it to 0 — no
  -- separate early-return guard needed.
  v_elapsed := (extract(year from date_trunc('month', current_date)) - extract(year from v_effective_start))::int * 12
    + (extract(month from date_trunc('month', current_date)) - extract(month from v_effective_start))::int;
  return greatest(0, least(12, v_elapsed));
end;
$function$;

-- ============ admin_create_employee — no advance credit at hire (arrears, no exceptions) ============

create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_row employees; v_joining_date date; v_months numeric;
  v_cl_quota numeric; v_el_quota numeric;
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

  -- Arrears model — no CL/EL credited at hire, regardless of joining day. The first
  -- credit lands via run_monthly_leave_accrual() once their joining month (or the
  -- following month, per the ≤15th cutoff months_remaining_in_fy already applies to
  -- `quota`) actually completes, same as everyone else.
  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values
    (v_row.id, 'Casual Leave', 0, 0, 0, v_cl_quota, 'Days'),
    (v_row.id, 'Earned Leave', 0, 0, 0, v_el_quota, 'Days'),
    (v_row.id, 'Sick Leave', 4, 0, 4, 4, 'Days')
  on conflict (emp_id, leave_type, financial_year) do nothing;

  perform log_audit('EMPLOYEE_CREATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;
$function$;

-- ============ One-time correction (supersedes 0025's, same ledger period key on
-- purpose — this overwrites that entry with the corrected number rather than leaving a
-- stale duplicate) ============

do $$
declare
  v_period date := date_trunc('month', current_date)::date;
  v_rec record;
  v_new_accrued numeric;
  v_new_balance numeric;
  v_delta numeric;
begin
  for v_rec in
    select lb.id, lb.emp_id, lb.leave_type, lb.accrued, lb.consumed, lb.quota, e.joining_date
    from leave_balances lb
    join employees e on e.id = lb.emp_id
    where lb.financial_year = current_fy() and lb.leave_type in ('Casual Leave', 'Earned Leave')
  loop
    v_new_accrued := case v_rec.leave_type
      when 'Casual Leave' then least(v_rec.quota, months_elapsed_in_fy(v_rec.joining_date) * 1)
      when 'Earned Leave' then least(v_rec.quota, months_elapsed_in_fy(v_rec.joining_date) * 0.5)
    end;
    v_delta := v_new_accrued - v_rec.accrued;
    continue when v_delta = 0;
    v_new_balance := v_new_accrued - v_rec.consumed;

    update leave_balances set accrued = v_new_accrued, balance = v_new_balance where id = v_rec.id;

    insert into leave_accruals (emp_id, leave_type, period, credited, used, running_balance, note)
    values (
      v_rec.emp_id, v_rec.leave_type, v_period,
      greatest(v_delta, 0), greatest(-v_delta, 0), v_new_balance,
      'v2_phase_c_arrears_accrual_correction'
    )
    on conflict (emp_id, leave_type, period) do update set
      credited = excluded.credited, used = excluded.used, running_balance = excluded.running_balance, note = excluded.note;
  end loop;
end $$;
